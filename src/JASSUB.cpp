#include "../lib/libass/libass/ass.h"
#include <cstdint>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>

#include <emscripten/bind.h>

int log_level = 3;

class ReusableBuffer {
private:
  void *buffer;
  size_t lessen_counter;

public:
  size_t size;
  ReusableBuffer() : buffer(NULL), size(0), lessen_counter(0) {
  }

  ~ReusableBuffer() {
    free(buffer);
  }

  void clear() {
    free(buffer);
    buffer = NULL;
    size = 0;
    lessen_counter = 0;
  }

  void *take(size_t new_size) {
    if (size >= new_size) {
      if (size >= 1.3 * new_size) {
        // big reduction request
        lessen_counter++;
      } else {
        lessen_counter = 0;
      }
      if (lessen_counter < 10) {
        // not reducing the buffer yet
        memset(buffer, 0, new_size);
        return buffer;
      }
    }

    free(buffer);
    buffer = malloc(new_size);
    if (buffer) {
      size = new_size;
      memset(buffer, 0, size);
    } else
      size = 0;
    lessen_counter = 0;
    return buffer;
  }
};

void msg_callback(int level, const char *fmt, va_list va, void *data) {
  if (level > log_level) // 6 for verbose
    return;

  const int ERR_LEVEL = 1;
  FILE *stream = level <= ERR_LEVEL ? stderr : stdout;

  fprintf(stream, "JASSUB: ");
  vfprintf(stream, fmt, va);
  fprintf(stream, "\n");
}

const float MIN_UINT8_CAST = 0.9 / 255;
const float MAX_UINT8_CAST = 255.9 / 255;

#define CLAMP_UINT8(value) ((value > MIN_UINT8_CAST) ? ((value < MAX_UINT8_CAST) ? (int)(value * 255) : 255) : 0)

typedef struct RenderResult {
public:
  int x, y, w, h;
  size_t image;
  RenderResult *next;
} RenderResult;

// maximum regions - a grid of 3x3
#define MAX_BLEND_STORAGES (3 * 3)
struct RenderBlendStorage {
  RenderResult next;
  ReusableBuffer buf;
  bool taken;
};

#define MIN(x, y) (((x) < (y)) ? (x) : (y))
#define MAX(x, y) (((x) > (y)) ? (x) : (y))

class BoundingBox {
public:
  int min_x, max_x, min_y, max_y;

  BoundingBox() : min_x(-1), max_x(-1), min_y(-1), max_y(-1) {
  }

  bool empty() const {
    return min_x == -1;
  }

  void add(int x1, int y1, int w, int h) {
    int x2 = x1 + w - 1, y2 = y1 + h - 1;
    min_x = (min_x < 0) ? x1 : MIN(min_x, x1);
    min_y = (min_y < 0) ? y1 : MIN(min_y, y1);
    max_x = (max_x < 0) ? x2 : MAX(max_x, x2);
    max_y = (max_y < 0) ? y2 : MAX(max_y, y2);
  }

  bool intersets(const BoundingBox &other) const {
    return !(other.min_x > max_x || other.max_x < min_x || other.min_y > max_y || other.max_y < min_y);
  }

  bool tryMerge(BoundingBox &other) {
    if (!intersets(other))
      return false;

    min_x = MIN(min_x, other.min_x);
    min_y = MIN(min_y, other.min_y);
    max_x = MAX(max_x, other.max_x);
    max_y = MAX(max_y, other.max_y);
    return true;
  }

  void clear() {
    min_x = max_x = min_y = max_y = -1;
  }
};

/**
 * \brief Overwrite tag with whitespace to nullify its effect
 * Boundaries are inclusive at both ends.
 */
static void _remove_tag(char *begin, char *end) {
  if (end < begin)
    return;
  memset(begin, ' ', end - begin + 1);
}

/**
 * \param begin point to the first character of the tag name (after backslash)
 * \param end   last character that can be read; at least the name itself
                and the following character if any must be included
 * \return true if tag may cause animations, false if it will definitely not
 */
static bool _is_animated_tag(char *begin, char *end) {
  if (end <= begin)
    return false;

  size_t length = end - begin + 1;

#define check_simple_tag(tag) (sizeof(tag) - 1 < length && !strncmp(begin, tag, sizeof(tag) - 1))
#define check_complex_tag(tag) (check_simple_tag(tag) && (begin[sizeof(tag) - 1] == '(' || begin[sizeof(tag) - 1] == ' ' || begin[sizeof(tag) - 1] == '\t'))
  switch (begin[0]) {
  case 'k': //-fallthrough
  case 'K':
    // Karaoke: k, kf, ko, K and kt ; no other valid ASS-tag starts with k/K
    return true;
  case 't':
    // Animated transform: no other valid tag begins with t
    // non-nested t-tags have to be complex tags even in single argument
    // form, but nested t-tags (which act like independent t-tags) are allowed to be
    // simple-tags without parentheses due to VSF-parsing quirk.
    // Since all valid simple t-tags require the existence of a complex t-tag, we only check for complex tags
    // to avoid false positives from invalid simple t-tags. This makes animation-dropping somewhat incorrect
    // but as animation detection remains accurate, we consider this to be "good enough"
    return check_complex_tag("t");
  case 'm':
    // Movement: complex tag; again no other valid tag begins with m
    // but ensure it's complex just to be sure
    return check_complex_tag("move");
  case 'f':
    // Fade: \fad and Fade (complex): \fade; both complex
    // there are several other valid tags beginning with f
    return check_complex_tag("fad") || check_complex_tag("fade");
  }

  return false;
#undef check_complex_tag
#undef check_simple_tag
}

/**
 * \param start First character after { (optionally spaces can be dropped)
 * \param end   Last character before } (optionally spaces can be dropped)
 * \param drop_animations If true animation tags will be discarded
 * \return true if after processing the event may contain animations
           (i.e. when dropping animations this is always false)
 */
static bool _is_block_animated(char *start, char *end, bool drop_animations) {
  char *tag_start = NULL; // points to beginning backslash
  for (char *p = start; p <= end; p++) {
    if (*p == '\\') {
      // It is safe to go one before and beyond unconditionally
      // because the text passed in must be surronded by { }
      if (tag_start && _is_animated_tag(tag_start + 1, p - 1)) {
        if (!drop_animations)
          return true;
        // For \t transforms this will assume the final state
        _remove_tag(tag_start, p - 1);
      }
      tag_start = p;
    }
  }

  if (tag_start && _is_animated_tag(tag_start + 1, end)) {
    if (!drop_animations)
      return true;
    _remove_tag(tag_start, end);
  }

  return false;
}

/**
 * \param event ASS event to be processed
 * \param drop_animations If true animation tags will be discarded
 * \return true if after processing the event may contain animations
           (i.e. when dropping animations this is always false)
 */
static bool _is_event_animated(ASS_Event *event, bool drop_animations) {
  // Event is animated if it has an Effect or animated override tags
  if (event->Effect && event->Effect[0] != '\0') {
    if (!drop_animations)
      return 1;
    event->Effect[0] = '\0';
  }

  // Search for override blocks
  // Only closed {...}-blocks are parsed by VSFilters and libass
  char *block_start = NULL; // points to opening {
  for (char *p = event->Text; *p != '\0'; p++) {
    switch (*p) {
    case '{':
      // Escaping the opening curly bracket to not start an override block is
      // a VSFilter-incompatible libass extension. But we only use libass, so...
      if (!block_start && (p == event->Text || *(p - 1) != '\\'))
        block_start = p;
      break;
    case '}':
      if (block_start && p - block_start > 2 && _is_block_animated(block_start + 1, p - 1, drop_animations))
        return true;
      block_start = NULL;
      break;
    default:
      break;
    }
  }

  return false;
}

static char *copyString(const std::string &str) {
  char *result = new char[str.length() + 1];
  strcpy(result, str.data());
  return result;
}

class JASSUB {
private:
  ReusableBuffer m_buffer;
  RenderBlendStorage m_blendParts[MAX_BLEND_STORAGES];
  bool drop_animations;
  int scanned_events; // next unscanned event index
  ASS_Library *ass_library;
  ASS_Renderer *ass_renderer;
  bool debug;

  int canvas_w;
  int canvas_h;

  int status;

  const char *defaultFont;

public:
  ASS_Track *track;

  int trackColorSpace;
  int changed = 0;
  int count = 0;
  JASSUB(int canvas_w, int canvas_h, const std::string &df, bool debug) {
    status = 0;
    ass_library = NULL;
    ass_renderer = NULL;
    track = NULL;
    this->canvas_w = canvas_w;
    this->canvas_h = canvas_h;
    drop_animations = false;
    scanned_events = 0;
    this->debug = debug;

    defaultFont = copyString(df);
    ass_library = ass_library_init();
    if (!ass_library) {
      fprintf(stderr, "JASSUB: ass_library_init failed!\n");
      exit(2);
    }

    ass_set_message_cb(ass_library, msg_callback, NULL);

    ass_renderer = ass_renderer_init(ass_library);
    if (!ass_renderer) {
      fprintf(stderr, "JASSUB: ass_renderer_init failed!\n");
      exit(3);
    }
    ass_set_extract_fonts(ass_library, true);

    resizeCanvas(canvas_w, canvas_h, canvas_w, canvas_h);

    reloadFonts();
    m_buffer.clear();
  }

  void setLogLevel(int level) {
    log_level = level;
  }

  void setDropAnimations(int value) {
    drop_animations = !!value;
    if (drop_animations)
      scanAnimations(scanned_events);
  }

  /*
   * \brief Scan events starting at index i for animations
   * and discard animated tags when found.
   * Note that once animated tags were dropped they cannot be restored.
   * Updates the class member scanned_events to last scanned index.
   */
  void scanAnimations(int i) {
    for (; i < track->n_events; i++) {
      _is_event_animated(track->events + i, drop_animations);
    }
    scanned_events = i;
  }

  /* TRACK */
  void createTrackMem(std::string buf) {
    removeTrack();
    track = ass_read_memory(ass_library, buf.data(), buf.size(), NULL);
    if (!track) {
      fprintf(stderr, "JASSUB: Failed to start a track\n");
      exit(4);
    }
    scanAnimations(0);

    trackColorSpace = track->YCbCrMatrix;
  }

  void removeTrack() {
    if (track != NULL) {
      ass_free_track(track);
      track = NULL;
    }
  }
  /* TRACK */

  /* CANVAS */
  void resizeCanvas(int canvas_w, int canvas_h, int video_w, int video_h) {
    ass_set_storage_size(ass_renderer, video_w, video_h);
    ass_set_frame_size(ass_renderer, canvas_w, canvas_h);
    this->canvas_h = canvas_h;
    this->canvas_w = canvas_w;
  }
  int getBufferSize(ASS_Image *img) {
    int size = 0;
    for (ASS_Image *tmp = img; tmp; tmp = tmp->next) {
      if (tmp->w == 0 || tmp->h == 0) {
        continue;
      }
      size += sizeof(uint32_t) * tmp->w * tmp->h + sizeof(RenderResult);
    }
    return size;
  }
  RenderResult *processImages(ASS_Image *img) {
    RenderResult *renderResult = NULL;
    char *rawbuffer = (char *)m_buffer.take(getBufferSize(img));
    if (rawbuffer == NULL) {
      fprintf(stderr, "JASSUB: cannot allocate buffer for rendering\n");
      return NULL;
    }
    for (RenderResult *tmp = renderResult; img; img = img->next) {
      int w = img->w, h = img->h;
      if (w == 0 || h == 0) continue;

      double alpha = (255 - (img->color & 255)) / 255.0;
      if (alpha == 0.0) continue;

      unsigned int datasize = sizeof(uint32_t) * w * h;
      size_t *data = (size_t *)rawbuffer;
      decodeBitmap(alpha, data, img, w, h);
      RenderResult *result = (RenderResult *)(rawbuffer + datasize);
      result->w = w;
      result->h = h;
      result->x = img->dst_x;
      result->y = img->dst_y;
      result->image = (size_t)data;
      result->next = NULL;

      if (tmp) {
        tmp->next = result;
      } else {
        renderResult = result;
      }
      tmp = result;

      rawbuffer += datasize + sizeof(RenderResult);
      ++count;
    }
    return renderResult;
  }

  void decodeBitmap(double alpha, size_t *data, ASS_Image *img, int w, int h) {
    uint32_t color = ((img->color << 8) & 0xff0000) | ((img->color >> 8) & 0xff00) | ((img->color >> 24) & 0xff);
    uint8_t *pos = img->bitmap;
    uint32_t res = 0;
    for (uint32_t y = 0; y < h; ++y, pos += img->stride) {
      for (uint32_t z = 0; z < w; ++z, ++res) {
        uint8_t mask = pos[z];
        if (mask != 0)
          data[res] = ((uint32_t)(alpha * mask) << 24) | color;
      }
    }
  }

  RenderResult *renderImage(double tm, int force) {
    count = 0;

    ASS_Image *imgs = ass_render_frame(ass_renderer, track, (int)(tm * 1000), &changed);
    if (imgs == NULL || (changed == 0 && !force)) return NULL;

    return processImages(imgs);
  }

  void quitLibrary() {
    removeTrack();
    ass_renderer_done(ass_renderer);
    ass_library_done(ass_library);
    m_buffer.clear();
  }

  void setDefaultFont(const std::string &name) {
    defaultFont = copyString(name);
    reloadFonts();
  }

  void reloadFonts() {
    ass_set_fonts(ass_renderer, NULL, defaultFont, ASS_FONTPROVIDER_NONE, NULL, 1);
  }

  void addFont(const std::string &name, int data, unsigned long data_size) {
    ass_add_font(ass_library, name.c_str(), (char *)data, (size_t)data_size);
    free((char *)data);
  }

  void setMargin(int top, int bottom, int left, int right) {
    ass_set_margins(ass_renderer, top, bottom, left, right);
  }

  int getEventCount() const {
    return track->n_events;
  }

  int allocEvent() {
    return ass_alloc_event(track);
  }

  void removeEvent(int eid) {
    ass_free_event(track, eid);
  }

  int getStyleCount() const {
    return track->n_styles;
  }

  int allocStyle() {
    return ass_alloc_style(track);
  }

  void removeStyle(int sid) {
    ass_free_event(track, sid);
  }

  void removeAllEvents() {
    ass_flush_events(track);
  }

  void setMemoryLimits(int glyph_limit, int bitmap_cache_limit) {
    printf("JASSUB: setting total libass memory limits to: glyph=%d MiB, bitmap cache=%d MiB\n", glyph_limit, bitmap_cache_limit);
    ass_set_cache_limits(ass_renderer, glyph_limit, bitmap_cache_limit);
  }

  RenderResult *renderBlend(double tm, int force) {
    count = 0;

    ASS_Image *img = ass_render_frame(ass_renderer, track, (int)(tm * 1000), &changed);
    if (img == NULL || (changed == 0 && !force)) {
      return NULL;
    }

    for (int i = 0; i < MAX_BLEND_STORAGES; i++) {
      m_blendParts[i].taken = false;
    }

    // split rendering region in 9 pieces (as on 3x3 grid)
    int split_x_low = canvas_w / 3, split_x_high = 2 * canvas_w / 3;
    int split_y_low = canvas_h / 3, split_y_high = 2 * canvas_h / 3;
    BoundingBox boxes[MAX_BLEND_STORAGES];
    for (ASS_Image *cur = img; cur != NULL; cur = cur->next) {
      if (cur->w == 0 || cur->h == 0)
        continue; // skip empty images
      int index = 0;
      int middle_x = cur->dst_x + (cur->w >> 1), middle_y = cur->dst_y + (cur->h >> 1);
      if (middle_y > split_y_high) {
        index += 2 * 3;
      } else if (middle_y > split_y_low) {
        index += 1 * 3;
      }
      if (middle_x > split_x_high) {
        index += 2;
      } else if (middle_y > split_x_low) {
        index += 1;
      }
      boxes[index].add(cur->dst_x, cur->dst_y, cur->w, cur->h);
    }

    // now merge regions as long as there are intersecting regions
    for (;;) {
      bool merged = false;
      for (int box1 = 0; box1 < MAX_BLEND_STORAGES - 1; box1++) {
        if (boxes[box1].empty())
          continue;
        for (int box2 = box1 + 1; box2 < MAX_BLEND_STORAGES; box2++) {
          if (boxes[box2].empty())
            continue;
          if (boxes[box1].tryMerge(boxes[box2])) {
            boxes[box2].clear();
            merged = true;
          }
        }
      }
      if (!merged)
        break;
    }

    RenderResult *renderResult = NULL;
    for (int box = 0; box < MAX_BLEND_STORAGES; box++) {
      if (boxes[box].empty()) {
        continue;
      }
      RenderResult *part = renderBlendPart(boxes[box], img);
      if (part == NULL) {
        break; // memory allocation error
      }
      if (renderResult) {
        part->next = renderResult->next;
        renderResult->next = part;
      } else {
        renderResult = part;
      }

      ++count;
    }

    return renderResult;
  }

  RenderResult *renderBlendPart(const BoundingBox &rect, ASS_Image *img) {
    int width = rect.max_x - rect.min_x + 1, height = rect.max_y - rect.min_y + 1;

    // make float buffer for blending
    const size_t buffer_size = width * height * 4 * sizeof(float);
    float *buf = (float *)m_buffer.take(buffer_size);
    if (buf == NULL) {
      fprintf(stderr, "JASSUB: cannot allocate buffer for blending\n");
      return NULL;
    }

    // blend things in
    for (ASS_Image *cur = img; cur != NULL; cur = cur->next) {
      if (cur->dst_x < rect.min_x || cur->dst_y < rect.min_y)
        continue; // skip images not fully within render region
      int curw = cur->w, curh = cur->h;
      if (curw == 0 || curh == 0 || cur->dst_x + curw - 1 > rect.max_x || cur->dst_y + curh - 1 > rect.max_y)
        continue; // skip empty images or images outside render region
      int a = (255 - (cur->color & 0xFF));
      if (a == 0)
        continue; // skip transparent images

      int curs = (cur->stride >= curw) ? cur->stride : curw;
      int curx = cur->dst_x - rect.min_x, cury = cur->dst_y - rect.min_y;

      unsigned char *bitmap = cur->bitmap;
      float normalized_a = a / 255.0;
      float r = ((cur->color >> 24) & 0xFF) / 255.0;
      float g = ((cur->color >> 16) & 0xFF) / 255.0;
      float b = ((cur->color >> 8) & 0xFF) / 255.0;

      int buf_line_coord = cury * width;
      for (int y = 0, bitmap_offset = 0; y < curh; y++, bitmap_offset += curs, buf_line_coord += width) {
        for (int x = 0; x < curw; x++) {
          float pix_alpha = bitmap[bitmap_offset + x] * normalized_a / 255.0;
          float inv_alpha = 1.0 - pix_alpha;

          int buf_coord = (buf_line_coord + curx + x) << 2;
          float *buf_r = buf + buf_coord;
          float *buf_g = buf + buf_coord + 1;
          float *buf_b = buf + buf_coord + 2;
          float *buf_a = buf + buf_coord + 3;

          // do the compositing, pre-multiply image RGB with alpha for current pixel
          *buf_a = pix_alpha + *buf_a * inv_alpha;
          *buf_r = r * pix_alpha + *buf_r * inv_alpha;
          *buf_g = g * pix_alpha + *buf_g * inv_alpha;
          *buf_b = b * pix_alpha + *buf_b * inv_alpha;
        }
      }
    }

    // find closest free buffer
    size_t needed = sizeof(unsigned int) * width * height;
    RenderBlendStorage *storage = m_blendParts, *bigBuffer = NULL, *smallBuffer = NULL;
    for (int buffer_index = 0; buffer_index < MAX_BLEND_STORAGES; buffer_index++, storage++) {
      if (storage->taken)
        continue;
      if (storage->buf.size >= needed) {
        if (bigBuffer == NULL || bigBuffer->buf.size > storage->buf.size)
          bigBuffer = storage;
      } else {
        if (smallBuffer == NULL || smallBuffer->buf.size > storage->buf.size)
          smallBuffer = storage;
      }
    }

    if (bigBuffer != NULL) {
      storage = bigBuffer;
    } else if (smallBuffer != NULL) {
      storage = smallBuffer;
    } else {
      printf("JASSUB: cannot get a buffer for rendering part!\n");
      return NULL;
    }

    unsigned int *result = (unsigned int *)storage->buf.take(needed);
    if (result == NULL) {
      printf("JASSUB: cannot make a buffer for rendering part!\n");
      return NULL;
    }
    storage->taken = true;

    // now build the result;
    for (int y = 0, buf_line_coord = 0; y < height; y++, buf_line_coord += width) {
      for (int x = 0; x < width; x++) {
        unsigned int pixel = 0;
        int buf_coord = (buf_line_coord + x) << 2;
        float alpha = buf[buf_coord + 3];
        if (alpha > MIN_UINT8_CAST) {
          // need to un-multiply the result
          float value = buf[buf_coord] / alpha;
          pixel |= CLAMP_UINT8(value); // R
          value = buf[buf_coord + 1] / alpha;
          pixel |= CLAMP_UINT8(value) << 8; // G
          value = buf[buf_coord + 2] / alpha;
          pixel |= CLAMP_UINT8(value) << 16; // B
          pixel |= CLAMP_UINT8(alpha) << 24; // A
        }
        result[buf_line_coord + x] = pixel;
      }
    }

    // return the thing
    storage->next.x = rect.min_x;
    storage->next.y = rect.min_y;
    storage->next.w = width;
    storage->next.h = height;
    storage->next.image = (size_t)result;

    return &storage->next;
  }

  // BINDING
  ASS_Event *getEvent(int i) {
    return &track->events[i];
  }

  ASS_Style *getStyle(int i) {
    return &track->styles[i];
  }

  void styleOverride(ASS_Style style) {
    int set_force_flags = ASS_OVERRIDE_BIT_STYLE
      | ASS_OVERRIDE_BIT_SELECTIVE_FONT_SCALE;
    
    ass_set_selective_style_override_enabled(ass_renderer, set_force_flags);
    ass_set_selective_style_override(ass_renderer, &style);
    ass_set_font_scale(ass_renderer, 0.3);
  }

  void disableStyleOverride() {
    ass_set_selective_style_override_enabled(ass_renderer, 0);
    ass_set_font_scale(ass_renderer, 1);
  }
};

static uint32_t getDuration(const ASS_Event &evt) {
  return (uint32_t)evt.Duration;
}

static void setDuration(ASS_Event &evt, const long ms) {
  evt.Duration = ms;
}

static uint32_t getStart(const ASS_Event &evt) {
  return (uint32_t)evt.Start;
}

static void setStart(ASS_Event &evt, const long ms) {
  evt.Start = ms;
}

static std::string getEventName(const ASS_Event &evt) {
  return evt.Name;
}

static void setEventName(ASS_Event &evt, const std::string &str) {
  evt.Name = copyString(str);
}

static std::string getText(const ASS_Event &evt) {
  return evt.Text;
}

static void setText(ASS_Event &evt, const std::string &str) {
  evt.Text = copyString(str);
}

static std::string getEffect(const ASS_Event &evt) {
  return evt.Effect;
}

static void setEffect(ASS_Event &evt, const std::string &str) {
  evt.Effect = copyString(str);
}

static std::string getStyleName(const ASS_Style &style) {
  return style.Name;
}

static void setStyleName(ASS_Style &style, const std::string &str) {
  style.Name = copyString(str);
}

static std::string getFontName(const ASS_Style &style) {
  return style.FontName;
}

static void setFontName(ASS_Style &style, const std::string &str) {
  style.FontName = copyString(str);
}

static RenderResult getNext(const RenderResult &res) {
  return *res.next;
}

EMSCRIPTEN_BINDINGS(JASSUB) {
  emscripten::class_<RenderResult>("RenderResult")
    .property("x", &RenderResult::x)
    .property("y", &RenderResult::y)
    .property("w", &RenderResult::w)
    .property("h", &RenderResult::h)
    .property("next", &getNext)
    .property("image", &RenderResult::image);

  emscripten::class_<ASS_Style>("ASS_Style")
    .property("Name", &getStyleName, &setStyleName)    
    .property("FontName", &getFontName, &setFontName) 
    .property("FontSize", &ASS_Style::FontSize)
    .property("PrimaryColour", &ASS_Style::PrimaryColour)
    .property("SecondaryColour", &ASS_Style::SecondaryColour)
    .property("OutlineColour", &ASS_Style::OutlineColour)
    .property("BackColour", &ASS_Style::BackColour)
    .property("Bold", &ASS_Style::Bold)     
    .property("Italic", &ASS_Style::Italic)   
    .property("Underline", &ASS_Style::Underline) 
    .property("StrikeOut", &ASS_Style::StrikeOut)
    .property("ScaleX", &ASS_Style::ScaleX) 
    .property("ScaleY", &ASS_Style::ScaleY) 
    .property("Spacing", &ASS_Style::Spacing)
    .property("Angle", &ASS_Style::Angle)
    .property("BorderStyle", &ASS_Style::BorderStyle)
    .property("Outline", &ASS_Style::Outline)
    .property("Shadow", &ASS_Style::Shadow)
    .property("Alignment", &ASS_Style::Alignment) 
    .property("MarginL", &ASS_Style::MarginL)
    .property("MarginR", &ASS_Style::MarginR)
    .property("MarginV", &ASS_Style::MarginV)
    .property("Encoding", &ASS_Style::Encoding)
    .property("treat_fontname_as_pattern", &ASS_Style::treat_fontname_as_pattern) 
    .property("Blur", &ASS_Style::Blur) 
    .property("Justify", &ASS_Style::Justify);

  emscripten::class_<ASS_Event>("ASS_Event")
    .property("Start", &getStart, &setStart)
    .property("Duration", &getDuration, &setDuration)
    .property("Name", &getEventName, &setEventName)
    .property("Effect", &getEffect, &setEffect)
    .property("Text", &getText, &setText)
    .property("ReadOrder", &ASS_Event::ReadOrder)
    .property("Layer", &ASS_Event::Layer)
    .property("Style", &ASS_Event::Style)
    .property("MarginL", &ASS_Event::MarginL)
    .property("MarginR", &ASS_Event::MarginR)
    .property("MarginV", &ASS_Event::MarginV);

  emscripten::class_<JASSUB>("JASSUB")
    .constructor<int, int, std::string, bool>()
    .function("setLogLevel", &JASSUB::setLogLevel)
    .function("setDropAnimations", &JASSUB::setDropAnimations)
    .function("createTrackMem", &JASSUB::createTrackMem)
    .function("removeTrack", &JASSUB::removeTrack)
    .function("resizeCanvas", &JASSUB::resizeCanvas)
    .function("quitLibrary", &JASSUB::quitLibrary)
    .function("addFont", &JASSUB::addFont)
    .function("reloadFonts", &JASSUB::reloadFonts)
    .function("setMargin", &JASSUB::setMargin)
    .function("getEventCount", &JASSUB::getEventCount)
    .function("allocEvent", &JASSUB::allocEvent)
    .function("allocStyle", &JASSUB::allocStyle)
    .function("removeEvent", &JASSUB::removeEvent)
    .function("getStyleCount", &JASSUB::getStyleCount)
    .function("removeStyle", &JASSUB::removeStyle)
    .function("removeAllEvents", &JASSUB::removeAllEvents)
    .function("setMemoryLimits", &JASSUB::setMemoryLimits)
    .function("renderBlend", &JASSUB::renderBlend, emscripten::allow_raw_pointers())
    .function("renderImage", &JASSUB::renderImage, emscripten::allow_raw_pointers())
    .function("getEvent", &JASSUB::getEvent, emscripten::allow_raw_pointers())
    .function("getStyle", &JASSUB::getStyle, emscripten::allow_raw_pointers())
    .function("styleOverride", &JASSUB::styleOverride, emscripten::allow_raw_pointers())
    .function("disableStyleOverride", &JASSUB::disableStyleOverride)
    .function("setDefaultFont", &JASSUB::setDefaultFont)
    .property("trackColorSpace", &JASSUB::trackColorSpace)
    .property("changed", &JASSUB::changed)
    .property("count", &JASSUB::count);
}

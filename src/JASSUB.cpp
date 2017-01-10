#include "../lib/libass/libass/ass.h"
#include <cstdint>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>

#include <emscripten/bind.h>

int log_level = 3;

void msg_callback(int level, const char *fmt, va_list va, void *data) {
  if (level > log_level) // 6 for verbose
    return;

  const int ERR_LEVEL = 1;
  FILE *stream = level <= ERR_LEVEL ? stderr : stdout;

  fprintf(stream, "JASSUB: ");
  vfprintf(stream, fmt, va);
  fprintf(stream, "\n");
}

static char *copyString(const std::string &str) {
  char *result = new char[str.length() + 1];
  strcpy(result, str.data());
  return result;
}

class JASSUB {
private:
  ASS_Library *ass_library;
  ASS_Renderer *ass_renderer;

  int canvas_w;
  int canvas_h;

  int status;

  const char *defaultFont;

public:
  ASS_Track *track;

  int trackColorSpace;
  int changed = 0;
  int count = 0;
  JASSUB(int canvas_w, int canvas_h, const std::string &df) {
    status = 0;
    ass_library = NULL;
    ass_renderer = NULL;
    track = NULL;
    this->canvas_w = canvas_w;
    this->canvas_h = canvas_h;

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
  }

  void setLogLevel(int level) {
    log_level = level;
  }

  void createTrackMem(std::string buf) {
    removeTrack();
    track = ass_read_memory(ass_library, buf.data(), buf.size(), NULL);
    if (!track) {
      fprintf(stderr, "JASSUB: Failed to start a track\n");
      exit(4);
    }

    trackColorSpace = track->YCbCrMatrix;
  }

  void removeTrack() {
    if (track != NULL) {
      ass_free_track(track);
      track = NULL;
    }
  }

  void resizeCanvas(int canvas_w, int canvas_h, int video_w, int video_h) {
    ass_set_storage_size(ass_renderer, video_w, video_h);
    ass_set_frame_size(ass_renderer, canvas_w, canvas_h);
    this->canvas_h = canvas_h;
    this->canvas_w = canvas_w;
  }

  ASS_Image *rawRender(double tm, int force) {
    count = 0;
    ASS_Image *imgs = ass_render_frame(ass_renderer, track, (long long)(tm * 1e+3 + 0.5), &changed);
    if (imgs == NULL || (changed == 0 && !force))
      return NULL;

    // count, because embind is not good with null pointers
    for (ASS_Image *img = imgs; img; img = img->next) {
      ++count;
    }

    return imgs;
  }

  void quitLibrary() {
    removeTrack();
    ass_renderer_done(ass_renderer);
    ass_library_done(ass_library);
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

  unsigned setThreads(int threads) {
    return ass_set_threads(ass_renderer, threads);
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
    ass_set_cache_limits(ass_renderer, glyph_limit, bitmap_cache_limit);
  }

  // BINDING
  ASS_Event *getEvent(int i) {
    return &track->events[i];
  }

  ASS_Style *getStyle(int i) {
    return &track->styles[i];
  }

  void styleOverride(ASS_Style style) {
    int set_force_flags = ASS_OVERRIDE_BIT_STYLE | ASS_OVERRIDE_BIT_SELECTIVE_FONT_SCALE;

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

static void setDuration(ASS_Event &evt, uint32_t ms) {
  evt.Duration = ms;
}

static uint32_t getStart(const ASS_Event &evt) {
  return (uint32_t)evt.Start;
}

static void setStart(ASS_Event &evt, uint32_t ms) {
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

static ASS_Image getNext(const ASS_Image &res) {
  return *res.next;
}

static uintptr_t getBitmapPtr(const ASS_Image &img) {
  return (uintptr_t)img.bitmap;
}

EMSCRIPTEN_BINDINGS(JASSUB) {
  emscripten::class_<ASS_Image>("ASS_Image")
    .property("w", &ASS_Image::w)
    .property("h", &ASS_Image::h)
    .property("dst_x", &ASS_Image::dst_x)
    .property("dst_y", &ASS_Image::dst_y)
    .property("next", &getNext)
    .property("bitmap", &getBitmapPtr)
    .property("color", &ASS_Image::color)
    .property("stride", &ASS_Image::stride);

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

  emscripten::class_<JASSUB>("JASSUB").constructor<int, int, std::string>()
    .function("setLogLevel", &JASSUB::setLogLevel)
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
    .function("setThreads", &JASSUB::setThreads)
    .function("getStyleCount", &JASSUB::getStyleCount)
    .function("removeStyle", &JASSUB::removeStyle)
    .function("removeAllEvents", &JASSUB::removeAllEvents)
    .function("setMemoryLimits", &JASSUB::setMemoryLimits)
    .function("rawRender", &JASSUB::rawRender, emscripten::allow_raw_pointers())
    .function("getEvent", &JASSUB::getEvent, emscripten::allow_raw_pointers())
    .function("getStyle", &JASSUB::getStyle, emscripten::allow_raw_pointers())
    .function("styleOverride", &JASSUB::styleOverride, emscripten::allow_raw_pointers())
    .function("disableStyleOverride", &JASSUB::disableStyleOverride)
    .function("setDefaultFont", &JASSUB::setDefaultFont)
    .property("trackColorSpace", &JASSUB::trackColorSpace)
    .property("changed", &JASSUB::changed)
    .property("count", &JASSUB::count);
}

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

static char *copyString(emscripten::val v) {
  return (char*)EM_ASM_PTR({
    return stringToNewUTF8(Emval.toValue($0));
  }, v.as_handle());
}

static void applyStyleStringFields(ASS_Style &style, emscripten::val obj) {
  auto read = [&](const char *key) { return obj[key]; };
  auto v = read("Name");
  if (!v.isUndefined()) style.Name = copyString(v);
  v = read("FontName");
  if (!v.isUndefined()) style.FontName = copyString(v);
}

static void applyStyleCommonFields(ASS_Style &style, emscripten::val obj) {
  auto read = [&](const char *key) { return obj[key]; };
  auto v = read("FontSize");                   if (!v.isUndefined()) style.FontSize = v.as<double>();
  v = read("PrimaryColour");                    if (!v.isUndefined()) style.PrimaryColour = v.as<uint32_t>();
  v = read("SecondaryColour");                  if (!v.isUndefined()) style.SecondaryColour = v.as<uint32_t>();
  v = read("OutlineColour");                    if (!v.isUndefined()) style.OutlineColour = v.as<uint32_t>();
  v = read("BackColour");                       if (!v.isUndefined()) style.BackColour = v.as<uint32_t>();
  v = read("Bold");                             if (!v.isUndefined()) style.Bold = v.as<int>();
  v = read("Italic");                           if (!v.isUndefined()) style.Italic = v.as<int>();
  v = read("Underline");                        if (!v.isUndefined()) style.Underline = v.as<int>();
  v = read("StrikeOut");                        if (!v.isUndefined()) style.StrikeOut = v.as<int>();
  v = read("ScaleX");                           if (!v.isUndefined()) style.ScaleX = v.as<double>();
  v = read("ScaleY");                           if (!v.isUndefined()) style.ScaleY = v.as<double>();
  v = read("Spacing");                          if (!v.isUndefined()) style.Spacing = v.as<double>();
  v = read("Angle");                            if (!v.isUndefined()) style.Angle = v.as<double>();
  v = read("BorderStyle");                      if (!v.isUndefined()) style.BorderStyle = v.as<int>();
  v = read("Outline");                          if (!v.isUndefined()) style.Outline = v.as<double>();
  v = read("Shadow");                           if (!v.isUndefined()) style.Shadow = v.as<double>();
  v = read("Alignment");                        if (!v.isUndefined()) style.Alignment = v.as<int>();
  v = read("MarginL");                          if (!v.isUndefined()) style.MarginL = v.as<int>();
  v = read("MarginR");                          if (!v.isUndefined()) style.MarginR = v.as<int>();
  v = read("MarginV");                          if (!v.isUndefined()) style.MarginV = v.as<int>();
  v = read("Encoding");                         if (!v.isUndefined()) style.Encoding = v.as<int>();
  v = read("treat_fontname_as_pattern");        if (!v.isUndefined()) style.treat_fontname_as_pattern = v.as<int>();
  v = read("Blur");                             if (!v.isUndefined()) style.Blur = v.as<double>();
  v = read("Justify");                          if (!v.isUndefined()) style.Justify = v.as<int>();
}

class JASSUB {
private:
  ASS_Library *ass_library;
  ASS_Renderer *ass_renderer;

  int canvas_w;
  int canvas_h;

  const char *defaultFont;

public:
  ASS_Track *track;

  int trackColorSpace;
  JASSUB(int canvas_w, int canvas_h, emscripten::val df) {
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

  emscripten::val rawRender(double tm, int force) {
    int changed = 0;
    ASS_Image *imgs = ass_render_frame(ass_renderer, track, (long long)(tm * 1e+3 + 0.5), &changed);
    if (imgs == NULL || (changed == 0 && !force))
      return emscripten::val::null();

    emscripten::val arr = emscripten::val::array();
    for (ASS_Image *img = imgs; img; img = img->next) {
      emscripten::val obj = emscripten::val::object();
      obj.set("w", img->w);
      obj.set("h", img->h);
      obj.set("dst_x", img->dst_x);
      obj.set("dst_y", img->dst_y);
      obj.set("bitmap", (uintptr_t)img->bitmap);
      obj.set("color", img->color);
      obj.set("stride", img->stride);
      arr.call<emscripten::val>("push", obj);
    }
    return arr;
  }

  emscripten::val getEvents() {
    emscripten::val arr = emscripten::val::array();
    for (int i = 0; i < track->n_events; i++) {
      ASS_Event &evt = track->events[i];
      emscripten::val obj = emscripten::val::object();
      obj.set("Start", (uint32_t)evt.Start);
      obj.set("Duration", (uint32_t)evt.Duration);
      obj.set("ReadOrder", evt.ReadOrder);
      obj.set("Layer", evt.Layer);
      obj.set("Style", evt.Style);
      obj.set("MarginL", evt.MarginL);
      obj.set("MarginR", evt.MarginR);
      obj.set("MarginV", evt.MarginV);
      obj.set("Name", evt.Name ? std::string(evt.Name) : "");
      obj.set("Text", evt.Text ? std::string(evt.Text) : "");
      obj.set("Effect", evt.Effect ? std::string(evt.Effect) : "");
      arr.call<emscripten::val>("push", obj);
    }
    return arr;
  }

  emscripten::val getStyles() {
    emscripten::val arr = emscripten::val::array();
    for (int i = 0; i < track->n_styles; i++) {
      ASS_Style &style = track->styles[i];
      emscripten::val obj = emscripten::val::object();
      obj.set("Name", style.Name ? std::string(style.Name) : "");
      obj.set("FontName", style.FontName ? std::string(style.FontName) : "");
      obj.set("FontSize", style.FontSize);
      obj.set("PrimaryColour", style.PrimaryColour);
      obj.set("SecondaryColour", style.SecondaryColour);
      obj.set("OutlineColour", style.OutlineColour);
      obj.set("BackColour", style.BackColour);
      obj.set("Bold", style.Bold);
      obj.set("Italic", style.Italic);
      obj.set("Underline", style.Underline);
      obj.set("StrikeOut", style.StrikeOut);
      obj.set("ScaleX", style.ScaleX);
      obj.set("ScaleY", style.ScaleY);
      obj.set("Spacing", style.Spacing);
      obj.set("Angle", style.Angle);
      obj.set("BorderStyle", style.BorderStyle);
      obj.set("Outline", style.Outline);
      obj.set("Shadow", style.Shadow);
      obj.set("Alignment", style.Alignment);
      obj.set("MarginL", style.MarginL);
      obj.set("MarginR", style.MarginR);
      obj.set("MarginV", style.MarginV);
      obj.set("Encoding", style.Encoding);
      obj.set("treat_fontname_as_pattern", style.treat_fontname_as_pattern);
      obj.set("Blur", style.Blur);
      obj.set("Justify", style.Justify);
      arr.call<emscripten::val>("push", obj);
    }
    return arr;
  }

  void quitLibrary() {
    removeTrack();
    ass_renderer_done(ass_renderer);
    ass_library_done(ass_library);
  }

  void setDefaultFont(emscripten::val name) {
    defaultFont = copyString(name);
    reloadFonts();
  }

  void reloadFonts() {
    ass_set_fonts(ass_renderer, NULL, defaultFont, ASS_FONTPROVIDER_NONE, NULL, 1);
  }

  void addFont(emscripten::val name, int data, unsigned long data_size) {
    char *ptr = copyString(name);
    ass_add_font(ass_library, ptr, (char *)data, (size_t)data_size);
    free(ptr);
    free((char *)data);
  }

  void setMargin(int top, int bottom, int left, int right) {
    ass_set_margins(ass_renderer, top, bottom, left, right);
  }

  unsigned setThreads(int threads) {
    return ass_set_threads(ass_renderer, threads);
  }

  void removeEvent(int eid) {
    ass_free_event(track, eid);
  }

  void removeStyle(int sid) {
    ass_free_style(track, sid);
  }

  void removeAllEvents() {
    ass_flush_events(track);
  }

  void setMemoryLimits(int glyph_limit, int bitmap_cache_limit) {
    ass_set_cache_limits(ass_renderer, glyph_limit, bitmap_cache_limit);
  }

  void processData(const std::string &data) {
    ass_process_data(track, data.data(), data.size());
  }


  void createEvent(emscripten::val obj) {
    setEvent(ass_alloc_event(track), obj);
  }

  void setEvent(int index, emscripten::val obj) {
    ASS_Event &evt = track->events[index];
    auto read = [&](const char *key) { return obj[key]; };

    auto v = read("Start");    if (!v.isUndefined()) evt.Start = v.as<uint32_t>();
    v = read("Duration");      if (!v.isUndefined()) evt.Duration = v.as<uint32_t>();
    v = read("ReadOrder");     if (!v.isUndefined()) evt.ReadOrder = v.as<int>();
    v = read("Layer");         if (!v.isUndefined()) evt.Layer = v.as<int>();
    v = read("Style");         if (!v.isUndefined()) evt.Style = v.as<int>();
    v = read("MarginL");       if (!v.isUndefined()) evt.MarginL = v.as<int>();
    v = read("MarginR");       if (!v.isUndefined()) evt.MarginR = v.as<int>();
    v = read("MarginV");       if (!v.isUndefined()) evt.MarginV = v.as<int>();
    v = read("Name");          if (!v.isUndefined()) evt.Name = copyString(v);
    v = read("Text");          if (!v.isUndefined()) evt.Text = copyString(v);
    v = read("Effect");        if (!v.isUndefined()) evt.Effect = copyString(v);
  }

  void createStyle(emscripten::val obj) {
    setStyle(ass_alloc_style(track), obj);
  }

  void setStyle(int index, emscripten::val obj) {
    ASS_Style &style = track->styles[index];
    applyStyleStringFields(style, obj);
    applyStyleCommonFields(style, obj);
  }

  void styleOverride(emscripten::val obj) {
    ASS_Style style = {};
    applyStyleStringFields(style, obj);
    applyStyleCommonFields(style, obj);

    int set_force_flags = ASS_OVERRIDE_BIT_STYLE | ASS_OVERRIDE_BIT_SELECTIVE_FONT_SCALE;

    ass_set_selective_style_override_enabled(ass_renderer, set_force_flags);
    ass_set_selective_style_override(ass_renderer, &style);
    ass_set_font_scale(ass_renderer, 0.3);

    free(style.Name);
    free(style.FontName);
  }

  void disableStyleOverride() {
    ass_set_selective_style_override_enabled(ass_renderer, 0);
    ass_set_font_scale(ass_renderer, 1);
  }
};

EMSCRIPTEN_BINDINGS(JASSUB) {
  emscripten::class_<JASSUB>("JASSUB").constructor<int, int, emscripten::val>()
    .function("setLogLevel", &JASSUB::setLogLevel)
    .function("createTrackMem", &JASSUB::createTrackMem)
    .function("removeTrack", &JASSUB::removeTrack)
    .function("resizeCanvas", &JASSUB::resizeCanvas)
    .function("quitLibrary", &JASSUB::quitLibrary)
    .function("addFont", &JASSUB::addFont)
    .function("reloadFonts", &JASSUB::reloadFonts)
    .function("setMargin", &JASSUB::setMargin)
    .function("getEvents", &JASSUB::getEvents)
    .function("getStyles", &JASSUB::getStyles)
    .function("createEvent", &JASSUB::createEvent)
    .function("setEvent", &JASSUB::setEvent)
    .function("createStyle", &JASSUB::createStyle)
    .function("setStyle", &JASSUB::setStyle)
    .function("removeEvent", &JASSUB::removeEvent)
    .function("setThreads", &JASSUB::setThreads)
    .function("removeStyle", &JASSUB::removeStyle)
    .function("removeAllEvents", &JASSUB::removeAllEvents)
    .function("setMemoryLimits", &JASSUB::setMemoryLimits)
    .function("processData", &JASSUB::processData)
    .function("rawRender", &JASSUB::rawRender)
    .function("styleOverride", &JASSUB::styleOverride)
    .function("disableStyleOverride", &JASSUB::disableStyleOverride)
    .function("setDefaultFont", &JASSUB::setDefaultFont)
    .property("trackColorSpace", &JASSUB::trackColorSpace);
}

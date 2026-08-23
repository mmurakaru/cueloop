// Flat, FFI-trivial wrapper over libghostty-vt: hides the allocator vtable, the
// by-value GhosttyPoint (which bun:ffi cannot pass), and the packed-cell decode,
// exposing exactly what an OpenTUI paint loop needs - new/write/resize/cell/free.
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <string.h>
#include "ghostty/vt/types.h"
#include "ghostty/vt/allocator.h"
#include "ghostty/vt/terminal.h"
#include "ghostty/vt/point.h"
#include "ghostty/vt/grid_ref.h"
#include "ghostty/vt/screen.h"
#include "ghostty/vt/style.h"
#include "ghostty/vt/color.h"

typedef struct {
  uint32_t codepoint;    // 0 = blank
  uint8_t fg_r, fg_g, fg_b, fg_kind;  // kind: 0 default, 1 palette (index in fg_r), 2 rgb
  uint8_t bg_r, bg_g, bg_b, bg_kind;
  uint8_t width;         // 0 (wide trailing), 1, 2
  uint8_t flags;         // bit0 bold, 1 italic, 2 underline, 3 inverse, 4 faint, 5 strikethrough
  uint16_t _pad;
} CvtCell;

void *cvt_new(uint16_t cols, uint16_t rows) {
  GhosttyTerminal t = NULL;
  // NULL allocator selects libghostty's default (libc malloc/free when linked).
  if (ghostty_terminal_new(NULL, &t, cols, rows) != GHOSTTY_SUCCESS) return NULL;
  return (void *)t;
}

void cvt_free(void *t) {
  if (t) ghostty_terminal_free((GhosttyTerminal)t);
}

void cvt_write(void *t, const uint8_t *data, size_t len) {
  ghostty_terminal_vt_write((GhosttyTerminal)t, data, len);
}

void cvt_resize(void *t, uint16_t cols, uint16_t rows) {
  // cell pixel size is irrelevant to the character grid; pass a nominal 1x1.
  ghostty_terminal_resize((GhosttyTerminal)t, cols, rows, 1, 1);
}

// Writes cursor state into out8: [0..1] col (u16), [2..3] row (u16), [4] visible (u8).
void cvt_cursor(void *t, uint8_t *out8) {
  uint16_t cx = 0, cy = 0;
  bool vis = false;
  ghostty_terminal_get((GhosttyTerminal)t, GHOSTTY_TERMINAL_DATA_CURSOR_X, &cx);
  ghostty_terminal_get((GhosttyTerminal)t, GHOSTTY_TERMINAL_DATA_CURSOR_Y, &cy);
  ghostty_terminal_get((GhosttyTerminal)t, GHOSTTY_TERMINAL_DATA_CURSOR_VISIBLE, &vis);
  memcpy(out8, &cx, 2);
  memcpy(out8 + 2, &cy, 2);
  out8[4] = vis ? 1 : 0;
}

static void decode_color(const GhosttyStyleColor *c, uint8_t *r, uint8_t *g, uint8_t *b,
                         uint8_t *kind) {
  if (c->tag == GHOSTTY_STYLE_COLOR_RGB) {
    *kind = 2;
    *r = c->value.rgb.r;
    *g = c->value.rgb.g;
    *b = c->value.rgb.b;
  } else if (c->tag == GHOSTTY_STYLE_COLOR_PALETTE) {
    *kind = 1;
    *r = (uint8_t)c->value.palette;  // palette index in r; JS maps 0-255 -> RGB
    *g = 0;
    *b = 0;
  } else {
    *kind = 0;
  }
}

// Reads the viewport cell at (x, y). Returns 0 on success, -1 otherwise.
int cvt_cell(void *t, uint16_t x, uint32_t y, CvtCell *out) {
  memset(out, 0, sizeof(*out));
  GhosttyPoint p;
  p.tag = GHOSTTY_POINT_TAG_VIEWPORT;
  p.value.coordinate.x = x;
  p.value.coordinate.y = y;
  GhosttyGridRef ref;
  if (ghostty_terminal_grid_ref((GhosttyTerminal)t, p, &ref) != GHOSTTY_SUCCESS) return -1;
  GhosttyCell cell;
  if (ghostty_grid_ref_cell(&ref, &cell) != GHOSTTY_SUCCESS) return -1;
  uint32_t cp = 0;
  ghostty_cell_get(cell, GHOSTTY_CELL_DATA_CODEPOINT, &cp);
  out->codepoint = cp;
  uint32_t wide = 0;
  ghostty_cell_get(cell, GHOSTTY_CELL_DATA_WIDE, &wide);
  out->width = (uint8_t)wide;
  GhosttyStyle st;
  ghostty_style_default(&st);
  if (ghostty_grid_ref_style(&ref, &st) == GHOSTTY_SUCCESS) {
    decode_color(&st.fg_color, &out->fg_r, &out->fg_g, &out->fg_b, &out->fg_kind);
    decode_color(&st.bg_color, &out->bg_r, &out->bg_g, &out->bg_b, &out->bg_kind);
    uint8_t f = 0;
    if (st.bold) f |= 1;
    if (st.italic) f |= 2;
    if (st.underline) f |= 4;
    if (st.inverse) f |= 8;
    if (st.faint) f |= 16;
    if (st.strikethrough) f |= 32;
    out->flags = f;
  }
  return 0;
}

// Flat FFI wrapper over libghostty-vt. It hides the allocator vtable, the
// by-value GhosttyPoint that bun:ffi cannot pass, and packed-cell decoding.
const std = @import("std");
const ghostty = @cImport({
    @cInclude("ghostty/vt/types.h");
    @cInclude("ghostty/vt/allocator.h");
    @cInclude("ghostty/vt/terminal.h");
    @cInclude("ghostty/vt/point.h");
    @cInclude("ghostty/vt/grid_ref.h");
    @cInclude("ghostty/vt/screen.h");
    @cInclude("ghostty/vt/style.h");
    @cInclude("ghostty/vt/color.h");
});

const CvtCell = extern struct {
    codepoint: u32,
    fg_r: u8,
    fg_g: u8,
    fg_b: u8,
    fg_kind: u8,
    bg_r: u8,
    bg_g: u8,
    bg_b: u8,
    bg_kind: u8,
    width: u8,
    flags: u8,
    _pad: u16,
};

comptime {
    std.debug.assert(@sizeOf(CvtCell) == 16);
}

export fn cvt_new(cols: u16, rows: u16) ?*anyopaque {
    var terminal: ghostty.GhosttyTerminal = null;
    if (ghostty.ghostty_terminal_new(null, &terminal, cols, rows) != ghostty.GHOSTTY_SUCCESS) {
        return null;
    }
    return terminal;
}

export fn cvt_free(terminal: ?*anyopaque) void {
    if (terminal) |handle| ghostty.ghostty_terminal_free(@ptrCast(handle));
}

export fn cvt_write(terminal: *anyopaque, data: [*]const u8, len: usize) void {
    ghostty.ghostty_terminal_vt_write(@ptrCast(terminal), data, len);
}

export fn cvt_resize(terminal: *anyopaque, cols: u16, rows: u16) void {
    // Cell pixel size does not affect the character grid.
    _ = ghostty.ghostty_terminal_resize(@ptrCast(terminal), cols, rows, 1, 1);
}

// Writes [col u16 LE, row u16 LE, visible u8] into the caller's eight bytes.
export fn cvt_cursor(terminal: *anyopaque, out: [*]u8) void {
    var x: u16 = 0;
    var y: u16 = 0;
    var visible = false;
    _ = ghostty.ghostty_terminal_get(@ptrCast(terminal), ghostty.GHOSTTY_TERMINAL_DATA_CURSOR_X, &x);
    _ = ghostty.ghostty_terminal_get(@ptrCast(terminal), ghostty.GHOSTTY_TERMINAL_DATA_CURSOR_Y, &y);
    _ = ghostty.ghostty_terminal_get(@ptrCast(terminal), ghostty.GHOSTTY_TERMINAL_DATA_CURSOR_VISIBLE, &visible);
    out[0] = @truncate(x);
    out[1] = @truncate(x >> 8);
    out[2] = @truncate(y);
    out[3] = @truncate(y >> 8);
    out[4] = @intFromBool(visible);
}

fn decodeColor(color: *const ghostty.GhosttyStyleColor, red: *u8, green: *u8, blue: *u8, kind: *u8) void {
    if (color.tag == ghostty.GHOSTTY_STYLE_COLOR_RGB) {
        kind.* = 2;
        red.* = color.value.rgb.r;
        green.* = color.value.rgb.g;
        blue.* = color.value.rgb.b;
    } else if (color.tag == ghostty.GHOSTTY_STYLE_COLOR_PALETTE) {
        kind.* = 1;
        red.* = @intCast(color.value.palette);
    }
}

export fn cvt_cell(terminal: *anyopaque, x: u16, y: u32, out: *CvtCell) c_int {
    out.* = std.mem.zeroes(CvtCell);

    var point: ghostty.GhosttyPoint = undefined;
    point.tag = ghostty.GHOSTTY_POINT_TAG_VIEWPORT;
    point.value.coordinate.x = x;
    point.value.coordinate.y = y;

    var reference: ghostty.GhosttyGridRef = undefined;
    if (ghostty.ghostty_terminal_grid_ref(@ptrCast(terminal), point, &reference) != ghostty.GHOSTTY_SUCCESS) return -1;

    var cell: ghostty.GhosttyCell = undefined;
    if (ghostty.ghostty_grid_ref_cell(&reference, &cell) != ghostty.GHOSTTY_SUCCESS) return -1;

    _ = ghostty.ghostty_cell_get(cell, ghostty.GHOSTTY_CELL_DATA_CODEPOINT, &out.codepoint);
    var width: u32 = 0;
    _ = ghostty.ghostty_cell_get(cell, ghostty.GHOSTTY_CELL_DATA_WIDE, &width);
    out.width = @intCast(width);

    var style: ghostty.GhosttyStyle = undefined;
    ghostty.ghostty_style_default(&style);
    if (ghostty.ghostty_grid_ref_style(&reference, &style) == ghostty.GHOSTTY_SUCCESS) {
        decodeColor(&style.fg_color, &out.fg_r, &out.fg_g, &out.fg_b, &out.fg_kind);
        decodeColor(&style.bg_color, &out.bg_r, &out.bg_g, &out.bg_b, &out.bg_kind);
        if (style.bold) out.flags |= 1;
        if (style.italic) out.flags |= 2;
        if (style.underline != 0) out.flags |= 4;
        if (style.inverse) out.flags |= 8;
        if (style.faint) out.flags |= 16;
        if (style.strikethrough) out.flags |= 32;
    }
    return 0;
}

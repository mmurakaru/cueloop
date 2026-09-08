/**
 * Row virtualization for an OpenTUI scrollbox, driven by @tanstack/virtual-core.
 * The core is DOM-free at heart: it only reaches the scroll container through the
 * observe/scroll callbacks given here, so a terminal scrollbox stands in for the
 * element - offsets and sizes are terminal rows, the "scroll event" is the
 * renderer's frame event, and a mounted row's height is read off its renderable.
 * Callers render `items` with a spacer of `items[0].start` rows above and
 * `totalSize - last.end` below, and hand each row's box to `measureRef(index)`.
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { Virtualizer, type VirtualItem } from "@tanstack/virtual-core";

export interface TerminalVirtualizerOptions {
  scrollbox: RefObject<ScrollBoxRenderable | null>;
  count: number;
  /** Rows an item occupies before it is measured (its wrapped visual lines). */
  estimateSize: (index: number) => number;
  /** Items this many rows beyond the viewport stay mounted, so a scroll step never shows a gap. */
  overscan: number;
}

export interface TerminalVirtualizer {
  items: VirtualItem[];
  totalSize: number;
  /** Ref callback for an item's row box, so its real height (cards included) replaces the estimate. */
  measureRef: (index: number) => (renderable: BoxRenderable | null) => void | (() => void);
  /** Scroll the item into view; "auto" only scrolls when it is off screen. */
  scrollToIndex: (index: number, align?: "auto" | "start" | "center" | "end") => void;
}

/**
 * The scroll container as the core reads it: the offset and the extents it clamps a scroll
 * target with. These are the `Element` members of the same names, so the view passes as one.
 */
interface ScrollContainerView {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

/** A mounted row as the core measures it: its height under the `Element` member name. */
interface RowView {
  readonly clientHeight: number;
}

type CoreVirtualizer = Virtualizer<Element, Element>;

function scrollContainerView(scrollbox: ScrollBoxRenderable): ScrollContainerView {
  return {
    get scrollTop() {
      return scrollbox.scrollTop;
    },
    get scrollHeight() {
      return scrollbox.scrollHeight;
    },
    get clientHeight() {
      return scrollbox.viewport.height;
    },
    get scrollWidth() {
      return scrollbox.scrollWidth;
    },
    get clientWidth() {
      return scrollbox.viewport.width;
    },
  };
}

function rowView(renderable: BoxRenderable): RowView {
  return {
    get clientHeight() {
      return renderable.height;
    },
  };
}

/**
 * The core's element generics are DOM-typed, but every way it touches the container or a row
 * (rect, offset, scroll, measurement, index lookup) is replaced here with a renderable-aware
 * callback, so a view exposing just the members it reads stands in for the element.
 */
function asElement(view: ScrollContainerView | RowView): Element {
  // SAFETY: the core never calls DOM methods on this value; its DOM defaults are all overridden.
  return view as Element;
}

export function useTerminalVirtualizer(options: TerminalVirtualizerOptions): TerminalVirtualizer {
  const renderer = useRenderer();
  const [, setRevision] = useState(0);
  // one stable view per mounted row box, so the core's element cache keeps its identity
  const viewOfRenderable = useRef(new WeakMap<BoxRenderable, Element>());
  const indexOfView = useRef(new WeakMap<Element, number>());
  const container = useRef<{ scrollbox: ScrollBoxRenderable; view: Element } | null>(null);

  const scrollContainer = (): Element | null => {
    const scrollbox = options.scrollbox.current;

    if (!scrollbox) return null;
    if (container.current?.scrollbox !== scrollbox) {
      container.current = { scrollbox, view: asElement(scrollContainerView(scrollbox)) };
    }

    return container.current.view;
  };
  const viewFor = (renderable: BoxRenderable): Element => {
    const known = viewOfRenderable.current.get(renderable);

    if (known) return known;
    const view = asElement(rowView(renderable));

    viewOfRenderable.current.set(renderable, view);

    return view;
  };

  // the offset reporter the core registered, so a scroll the core asks for reports at once
  const reportOffset = useRef<(() => void) | null>(null);

  // a frame-event poll stands in for scroll and resize events: the renderer fires it after every
  // render, and the callbacks only fire the core when the value actually changed
  const onFrame = (read: () => void): (() => void) => {
    read();
    renderer?.on("frame", read);

    return () => renderer?.off("frame", read);
  };

  const coreOptions = () => ({
    count: options.count,
    overscan: options.overscan,
    estimateSize: options.estimateSize,
    getScrollElement: scrollContainer,
    observeElementRect: (
      _instance: CoreVirtualizer,
      callback: (rect: { width: number; height: number }) => void,
    ) => {
      let last = { width: -1, height: -1 };

      return onFrame(() => {
        const scrollbox = options.scrollbox.current;

        if (!scrollbox) return;
        const next = { width: scrollbox.viewport.width, height: scrollbox.viewport.height };

        if (next.width === last.width && next.height === last.height) return;
        last = next;
        callback(next);
      });
    },
    observeElementOffset: (
      _instance: CoreVirtualizer,
      callback: (offset: number, isScrolling: boolean) => void,
    ) => {
      let last = -1;
      const report = (): void => {
        const scrollbox = options.scrollbox.current;

        if (!scrollbox || scrollbox.scrollTop === last) return;
        last = scrollbox.scrollTop;
        callback(last, false);
      };
      const stop = onFrame(report);

      reportOffset.current = report;

      return () => {
        reportOffset.current = null;
        stop();
      };
    },
    // report the new offset in the same tick: the item window then follows the scroll at once,
    // instead of one frame later with the target rows still unmounted
    scrollToFn: (offset: number) => {
      options.scrollbox.current?.scrollTo({ x: 0, y: Math.max(0, Math.round(offset)) });
      reportOffset.current?.();
    },
    // a box measures 0 until Yoga has laid it out; keep the estimate rather than collapse the row
    measureElement: (element: Element) =>
      element.clientHeight > 0
        ? element.clientHeight
        : options.estimateSize(indexOfView.current.get(element) ?? -1),
    onChange: () => setRevision((revision) => revision + 1),
  });

  const [virtualizer] = useState<CoreVirtualizer>(() => {
    const instance = new Virtualizer<Element, Element>(coreOptions());

    // the core looks an item's index up through a DOM attribute; ours is remembered per row view
    instance.indexFromElement = (element) => indexOfView.current.get(element) ?? -1;

    return instance;
  });

  virtualizer.setOptions(coreOptions());
  useLayoutEffect(() => {
    virtualizer._willUpdate();
  });
  useEffect(() => virtualizer._didMount(), [virtualizer]);
  // no ResizeObserver here: a mounted row's height settles after layout and grows when a card
  // opens under it, so every frame re-reads the mounted rows (the core only notifies on change)
  useEffect(
    () =>
      onFrame(() => {
        for (const element of virtualizer.elementsCache.values()) {
          virtualizer.measureElement(element);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [virtualizer, renderer],
  );

  return {
    items: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
    measureRef: (index) => (renderable) => {
      if (!renderable) return;
      const view = viewFor(renderable);

      indexOfView.current.set(view, index);
      virtualizer.measureElement(view);

      // the row unmounted: forget its view so the frame re-measure stops reading it
      return () => {
        if (virtualizer.elementsCache.get(index) === view) virtualizer.elementsCache.delete(index);
      };
    },
    scrollToIndex: (index, align = "auto") => virtualizer.scrollToIndex(index, { align }),
  };
}

export const PRODUCT_NAME = "Helios Agent IDE";
export const PRODUCT_SHORT_NAME = "Helios";
export const APP_SLUG = "thinkrail";
export const REPO_URL = "https://github.com/JetBrains/thinkrail";
export const STORAGE_PREFIX = `${APP_SLUG}-`;
export const DND_FILE_MIME = `application/x-${APP_SLUG}-file`;
export const EVENT_PREFIX = `${APP_SLUG}:`;

/**
 * The Helios mark in a 100 × 100 unit box (same artwork as the favicon): a sun inside a tilted orbit
 * with one satellite. Each segment is a closed region; the orbit's inner ellipse winds the opposite way,
 * so the joined path fills correctly under the default nonzero rule (favicon and icon generators).
 */
export const BRAND_MARK_SEGMENTS = {
	sun: "M62 50A12 12 0 1 0 38 50A12 12 0 1 0 62 50Z",
	orbit:
		"M89.84 27A46 24 -30 1 0 10.16 73A46 24 -30 1 0 89.84 27ZM83.77 30.5A39 17 -30 1 1 16.23 69.5A39 17 -30 1 1 83.77 30.5Z",
	satellite: "M72.31 22.74A6.5 6.5 0 1 0 59.31 22.74A6.5 6.5 0 1 0 72.31 22.74Z",
} as const;

/** The orbit's centreline (between the ring's two ellipses), for drawing it as a stroke. */
export const BRAND_ORBIT = { cx: 50, cy: 50, rx: 42.5, ry: 20.5, rotate: -30, width: 7 } as const;

export const BRAND_MARK_PATH = Object.values(BRAND_MARK_SEGMENTS).join("");

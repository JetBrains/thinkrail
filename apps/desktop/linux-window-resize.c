#include <dlfcn.h>
#include <stdint.h>
#include <stdlib.h>

typedef int gboolean;
typedef unsigned int guint32;
typedef gboolean (*source_callback)(void *);
typedef void (*main_context_invoke)(void *, source_callback, void *);
typedef void *(*display_get_default)(void);
typedef void *(*display_get_default_seat)(void *);
typedef void *(*seat_get_pointer)(void *);
typedef void (*device_get_position)(void *, void **, int *, int *);
typedef guint32 (*current_event_time)(void);
typedef void *(*widget_get_window)(void *);
typedef void (*window_begin_resize_drag)(void *, int, void *, int, int, int, guint32);

typedef struct {
	main_context_invoke invoke;
	display_get_default get_display;
	display_get_default_seat get_seat;
	seat_get_pointer get_pointer;
	device_get_position get_position;
	current_event_time get_time;
	widget_get_window get_window;
	window_begin_resize_drag begin_resize;
} resize_api;

typedef struct {
	void *window;
	int edge;
} resize_request;

static resize_api api;
static int loaded;

static int load_api(void) {
	if (loaded) return loaded > 0;
	void *glib = dlopen("libglib-2.0.so.0", RTLD_NOW | RTLD_LOCAL);
	void *gdk = dlopen("libgdk-3.so.0", RTLD_NOW | RTLD_LOCAL);
	void *gtk = dlopen("libgtk-3.so.0", RTLD_NOW | RTLD_LOCAL);
	if (!glib || !gdk || !gtk) {
		loaded = -1;
		return 0;
	}
	api.invoke = (main_context_invoke)dlsym(glib, "g_main_context_invoke");
	api.get_display = (display_get_default)dlsym(gdk, "gdk_display_get_default");
	api.get_seat = (display_get_default_seat)dlsym(gdk, "gdk_display_get_default_seat");
	api.get_pointer = (seat_get_pointer)dlsym(gdk, "gdk_seat_get_pointer");
	api.get_position = (device_get_position)dlsym(gdk, "gdk_device_get_position");
	api.get_time = (current_event_time)dlsym(gtk, "gtk_get_current_event_time");
	api.get_window = (widget_get_window)dlsym(gtk, "gtk_widget_get_window");
	api.begin_resize = (window_begin_resize_drag)dlsym(
		gdk,
		"gdk_window_begin_resize_drag_for_device"
	);
	loaded = api.invoke && api.get_display && api.get_seat && api.get_pointer &&
		api.get_position && api.get_time && api.get_window && api.begin_resize ? 1 : -1;
	return loaded > 0;
}

static gboolean begin_resize_on_main(void *data) {
	resize_request *request = (resize_request *)data;
	void *display = api.get_display();
	void *seat = display ? api.get_seat(display) : NULL;
	void *pointer = seat ? api.get_pointer(seat) : NULL;
	void *gdk_window = api.get_window(request->window);
	if (pointer && gdk_window) {
		int x = 0;
		int y = 0;
		api.get_position(pointer, NULL, &x, &y);
		api.begin_resize(gdk_window, request->edge, pointer, 1, x, y, api.get_time());
	}
	free(request);
	return 0;
}

int thinkrail_linux_resize_ready(void) {
	return load_api();
}

int thinkrail_linux_begin_resize(void *window, int edge) {
	if (!window || edge < 0 || edge > 7 || !load_api()) return 0;
	resize_request *request = (resize_request *)malloc(sizeof(resize_request));
	if (!request) return 0;
	request->window = window;
	request->edge = edge;
	api.invoke(NULL, begin_resize_on_main, request);
	return 1;
}

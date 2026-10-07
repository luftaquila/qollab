/* Pause a fresh XeTeX process at its first body open. It receives one document
 * and exits; no user state is shared with any subsequent job. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static int resumed;
static void gate(const char *path, const char *mode) {
    const char *base = strrchr(path, '/');
    base = base ? base + 1 : path;
    if (resumed || mode[0] != 'r' || strcmp(base, "qollab-body.tex")) return;
    resumed = 1;
    fflush(NULL);
    if (write(2, "QOLLAB_READY\n", 13) != 13) _exit(125);
    char command;
    if (read(0, &command, 1) != 1 || command != 'G') _exit(125);
}

FILE *fopen(const char *path, const char *mode) {
    static FILE *(*next)(const char *, const char *);
    if (!next) next = dlsym(RTLD_NEXT, "fopen");
    if (!next) _exit(125);
    gate(path, mode);
    return next(path, mode);
}

FILE *fopen64(const char *path, const char *mode) {
    static FILE *(*next)(const char *, const char *);
    if (!next) next = dlsym(RTLD_NEXT, "fopen64");
    if (!next) _exit(125);
    gate(path, mode);
    return next(path, mode);
}

#include <stdio.h>
#include <err.h>
#include <assert.h>
#include <stdint.h>
#include <stdlib.h>
#include <inttypes.h>
#include "fragment.h"

static const char hexvalues[] = "0123456789abcdef";

char *fragment_file_read_teamid_hex(FILE *fragment) {
    if (!fragment) return NULL;
    if (fseek(fragment, 0, SEEK_SET) != 0) {
        warn("%s: could not seek in file", __func__);
        return NULL;
    }
    uint8_t buf[TEAMLEN];
    if (fread(buf, 1, sizeof(buf), fragment) != sizeof(buf)) {
        warnx("%s: could not read enough data to get team id", __func__);
        return NULL;
    }
    char *hex = malloc(2*TEAMLEN+1);
    if (!hex) {
        warn("%s: could not allocate memory", __func__);
        return NULL;
    }
    for (int i=0; i<TEAMLEN; i++) {
        hex[2*i] = hexvalues[buf[i] >> 4];
        hex[2*i+1] = hexvalues[buf[i] & 0xf];
    }
    hex[2*TEAMLEN] = '\0';
    return hex;
}

static_assert(SEQLEN == 4, "SEQLEN must be 4");

int64_t fragment_file_read_seq(FILE *fragment) {
    if (!fragment) return -1;
    if (fseek(fragment, TEAMLEN, SEEK_SET) != 0) {
        warn("%s: could not seek in file", __func__);
        return -1;
    }
    uint8_t buf[SEQLEN];
    if (fread(buf, 1, sizeof(buf), fragment) != sizeof(buf)) {
        warnx("%s: could not read enough data to get sequence number", __func__);
        return -1;
    }
    uint32_t seq = ((uint32_t) buf[0] << 24) | ((uint32_t) buf[1] << 16)
                 | ((uint32_t) buf[2] << 8) | buf[3];
    return seq;
}

static_assert(OFFSETLEN == 1, "OFFSETLEN must be 1");

int fragment_file_read_raw_offset(FILE *fragment) {
    if (!fragment) return -1;
    if (fseek(fragment, TEAMLEN + SEQLEN, SEEK_SET) != 0) {
        warn("%s: could not seek in file", __func__);
        return -1;
    }
    uint8_t buf[OFFSETLEN];
    if (fread(buf, 1, sizeof(buf), fragment) != sizeof(buf)) {
        warnx("%s: could not read enough data to get offset", __func__);
        return -1;
    }
    return buf[0];
}

long fragment_file_first_message_offset(FILE *fragment) {
    if (!fragment) return -1;
    int raw = fragment_file_read_raw_offset(fragment);
    if (raw < 0) return -1;
    if (fseek(fragment, FRAGHDRLEN + raw, SEEK_SET) != 0) {
        warn("%s: could not seek in file", __func__);
        return -1;
    }
    long pos = ftell(fragment);
    if (fgetc(fragment) != EOF) {
        if (raw == 255) return 0;
        return pos;
    }
    if (ferror(fragment)) {
        warn("%s: could not read at offset", __func__);
        return -1;
    } else {
        return 0;
    }
}

static_assert(SEQLEN == 4, "SEQLEN must be 4");

char *format_seq(int64_t seq) {
    if (seq < 0 || seq > UINT32_MAX) {
        warnx("%s: sequence number out of range", __func__);
        return NULL;
    }
    char *s = malloc(11);
    if (!s) {
        warn("%s: could not allocate memory", __func__);
        return NULL;
    }
    sprintf(s, "%010"PRIu32, (uint32_t) seq);
    return s;
}

int64_t parse_seq(const char *seq) {
    if (seq == NULL || *seq == '\0') return -1;
    char *end = NULL;
    long long int s = strtoll(seq, &end, 10);
    if (s < 0 || s > UINT32_MAX || *end != '\0') {
        warn("%s: invalid sequence number (%s)", seq, __func__);
        return -1;
    }
    return s;
}

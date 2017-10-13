#include <stdio.h>
#include <err.h>
#include <assert.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include "message.h"
#include "fragment.h"

static_assert(MSG_TYPELEN == 1, "MSG_TYPELEN must be 1");
static_assert(MSG_LENGTHLEN == 2, "MSG_LENGTHLEN must be 2");

msg_info fragment_file_parse_message_header(FILE *fragment, long msg_offset) {
    msg_info info;
    info.type = -1;
    info.length = -1;
    if (!fragment) return info;
    if (fseek(fragment, msg_offset, SEEK_SET) != 0) {
        warn("%s: could not seek in file", __func__);
        return info;
    }
    uint8_t buf[MSG_TYPELEN + MSG_LENGTHLEN];
    size_t len = fread(buf, 1, sizeof(buf), fragment);
    if (len < MSG_TYPELEN) {
        warnx("%s: could not read start of message header", __func__);
        return info;
    }
    info.type = buf[0];
    if (len == 3) {
        info.length = ((unsigned long) buf[1] << 8) + buf[2];
    }
    return info;
}

int fragment_file_messages_started(FILE *fragment) {
    long off = fragment_file_first_message_offset(fragment);
    if (off < 0) return -1;
    if (off == 0) return 0;

    if (fseek(fragment, 0, SEEK_END) != 0) {
        warn("%s: could not seek in file", __func__);
        return -1;
    }
    long len = ftell(fragment);

    int msgs = 0;
    while (off < len) {
        msgs++;
        msg_info info = fragment_file_parse_message_header(fragment, off);
        if (info.type < 0) return -1;
        if (info.length < 0) return msgs;
        off += MSG_HDRLEN + info.length;
    }
    return msgs;
}

long fragment_file_offset_nth_message(FILE *fragment, int n) {
    if (n <= 0) return -1;
    long off = fragment_file_first_message_offset(fragment);
    if (off <= 0) return -1;
    if (n == 1) return off;

    if (fseek(fragment, 0, SEEK_END) != 0) {
        warn("%s: could not seek in file", __func__);
        return -1;
    }
    long len = ftell(fragment);

    while (--n > 0) {
        if (off >= len) return -1;
        msg_info info = fragment_file_parse_message_header(fragment, off);
        if (info.type < 0) return -1;
        if (info.length < 0) return -1;
        off += MSG_HDRLEN + info.length;
    }
    return off;
}

long fragments_extract_message(uint32_t seq, int n, uint8_t *buf, int *span) {
    char *seqstr = NULL;
    FILE *fragment = NULL;

    if (span) *span = 0;

    seqstr = format_seq(seq);
    if (!seqstr) goto extract_error;
    fragment = fopen(seqstr, "r");
    if (!fragment) {
        warn("%s", seqstr);
        goto extract_error;
    }
    if (span) (*span)++;
    long firstoff = 0;
    long off = fragment_file_offset_nth_message(fragment, n);
    if (off < 0) {
        warnx("%s: could not get offset of message %d (%s)", seqstr, n, __func__);
        goto extract_error;
    }
    uint8_t message_header[MSG_HDRLEN];
    long total_read = 0;
    while (1) {
        if (fseek(fragment, off, SEEK_SET) != 0) {
            warn("%s: could not seek in file", seqstr);
            goto extract_error;
        }
        size_t more = fread(message_header+total_read, 1, MSG_HDRLEN-total_read, fragment);
        if (ferror(fragment)) {
            warn("%s", seqstr);
            goto extract_error;
        } else if (more == 0) {
            warnx("%s: could not read any message bytes", seqstr);
            goto extract_error;
        }

        total_read += more;
        off += more;

        if (total_read == MSG_HDRLEN) break;

        /* open next fragment */
        if (seq == UINT32_MAX) {
            warnx("%s: reached fragment count limit", seqstr);
            goto extract_error;
        }
        free(seqstr);
        seqstr = format_seq(++seq);
        if (!seqstr) goto extract_error;
        fclose(fragment);
        fragment = fopen(seqstr, "r");
        if (!fragment) {
            warn("%s", seqstr);
            goto extract_error;
        }
        if (span) (*span)++;
        off = FRAGHDRLEN;
        firstoff = fragment_file_first_message_offset(fragment);
        if (firstoff < 0) {
            warnx("%s: could not read offset", seqstr);
            goto extract_error;
        } else if (firstoff > 0 && off+(MSG_HDRLEN-total_read) > firstoff) {
            warnx("%s: next message begins before current one finishes", seqstr);
            goto extract_error;
        }
    }

    long msg_len = ((unsigned long) message_header[1] << 8) + message_header[2];
    long total_len = MSG_HDRLEN + msg_len;

    if (buf) memcpy(buf+0, message_header, total_read);

    while ((msg_len > 0) && 1) {

        if (firstoff > 0 && off+(total_len-total_read) > firstoff) {
            warnx("%s: next message begins before current one finishes", seqstr);
            goto extract_error;
        }

        size_t more;
        if (buf) {
            more = fread(buf+total_read, 1, total_len - total_read, fragment);
            if (ferror(fragment)) {
                warn("%s", seqstr);
                goto extract_error;
            }
        } else {
            /* simulate read */
            if (fseek(fragment, 0, SEEK_END) != 0) {
                warn("%s: could not seek in file", seqstr);
                goto extract_error;
            }
            long remaining = ftell(fragment) - off;
            more = (remaining < total_len - total_read) ? remaining : total_len - total_read;
        }
        if (more == 0 && off == FRAGHDRLEN) {
            warnx("%s: fragment with no data", seqstr);
            goto extract_error;
        }

        total_read += more;
        off += more;

        if (total_read == total_len) break;

        /* open next fragment */
        if (seq == UINT32_MAX) {
            warnx("%s: reached fragment count limit", seqstr);
            goto extract_error;
        }
        free(seqstr);
        seqstr = format_seq(++seq);
        if (!seqstr) goto extract_error;
        fclose(fragment);
        fragment = fopen(seqstr, "r");
        if (!fragment) {
            warn("%s", seqstr);
            goto extract_error;
        }
        if (span) (*span)++;
        firstoff = fragment_file_first_message_offset(fragment);
        if (firstoff < 0) {
            warnx("%s: could not read offset", seqstr);
            goto extract_error;
        }
        off = FRAGHDRLEN;
        if (fseek(fragment, off, SEEK_SET) != 0) {
            warn("%s: could not seek in file", seqstr);
            goto extract_error;
        }
    }

    fclose(fragment);
    free(seqstr);

    return total_len;

extract_error:
    if (fragment) fclose(fragment);
    if (seqstr) free(seqstr);
    return 0;
}

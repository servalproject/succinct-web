#include <stdio.h>
#include <err.h>
#include <assert.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include "message.h"
#include "fragment.h"

#include "utf8.h"

static_assert(MSG_TYPELEN == 1, "MSG_TYPELEN must be 1");
static_assert(MSG_LENGTHLEN == 2, "MSG_LENGTHLEN must be 2");
static_assert(MSG_HDRLEN == 3, "MSG_HDRLEN must be 3");

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

static int parse_team_start(struct message_team_start *msg, uint8_t *payload, unsigned int len) {
    if (len < 9) return 0;
    if (payload[len-1] != '\0') return 0; // not null-terminated
    if (8 + strlen((char *)(payload+8)) + 1 != len) return 0; // too many null characters
    if (!utf8_validate(payload+8)) return 0;

    msg->time = payload[0];
    for (int i=1; i<8; i++) {
        msg->time = (msg->time << 8) + payload[i];
    }
    msg->name = strdup((char *)(payload+8));
    if (!msg->name) {
        warn("%s", __func__);
        return 0;
    }
    return 1;
}

static int parse_team_end(struct message_team_end *msg, uint8_t *payload, unsigned int len) {
    if (len != 8) return 0;
    msg->time = payload[0];
    for (int i=1; i<8; i++) {
        msg->time = (msg->time << 8) + payload[i];
    }
    return 1;
}

static int parse_member_join(struct message_member_join *msg, uint8_t *payload, unsigned int len) {
    if (len < 7) return 0;
    if (payload[len-1] != '\0') return 0; // not null-terminated
    int nullchars = 0;
    for (int i=5; i<len; i++) if (payload[i] == '\0') nullchars++;
    if (nullchars != 2) return 0; // should have two null-terminated strings
    if (!utf8_validate(payload+5)) return 0;
    size_t namelen = strlen((char *)(payload+5));
    if (!utf8_validate(payload+5+namelen+1)) return 0;

    msg->member = payload[0];
    msg->time = payload[1];
    for (int i=1; i<4; i++) {
        msg->time = (msg->time << 8) + payload[1+i];
    }
    msg->name = strdup((char *)(payload+5));
    if (!msg->name) {
        warn("%s", __func__);
        return 0;
    }
    msg->id = strdup((char *)(payload+5+namelen+1));
    if (!msg->id) {
        warn("%s", __func__);
        return 0;
    }
    return 1;
}

static int parse_member_part(struct message_member_part *msg, uint8_t *payload, unsigned int len) {
    if (len != 5) return 0;
    msg->member = payload[0];
    msg->time = payload[1];
    for (int i=1; i<4; i++) {
        msg->time = (msg->time << 8) + payload[1+i];
    }
    return 1;
}

static int parse_location(struct message_location *msg, uint8_t *payload, unsigned int len) {
    if (len == 0 || len%11 != 0) return 0;
    int records = len/11;

    msg->locations = malloc(records*sizeof(member_location));
    if (!msg->locations) {
        warn("%s", __func__);
        return 0;
    }
    msg->length = records;
    for (int i=0; i<records; i++) {
        msg->locations[i].member = payload[i*11];
        msg->locations[i].time = payload[i*11+1];
        for (int j=1; j<4; j++) {
            msg->locations[i].time = (msg->locations[i].time << 8) + payload[i*11+1+j];
        }
        uint64_t latlngacc = payload[i*11+5];
        for (int j=1; j<6; j++) {
            latlngacc = (latlngacc << 8) + payload[i*11+5+j];
        }
        /* see LocationFactory.java from succinct
         *
         * 48 least significant bits of (uint64_t) latlngacc:
         *
         * | (90 + lat) * 23301.686 | (180 + lng) * 23301.686 | accuracy |
	     *         22 bits                   23 bits             3 bits
         *
         * accuracy: 0       <= 10m
         *           1       <= 20m
         *           2       <= 50m
         *           3       <= 100m
         *           4       <= 200m
         *           5       <= 500m
         *           6       <= 1000m
         *           7        > 1000m
         *
         * note: 23301.686 = (2^23-1)/360 - eps
         */
        static const double lat_lng_scale = 23301.686;
        static const int accs[8] = {10, 20, 50, 100, 200, 500, 1000, -1};
        msg->locations[i].lat = (latlngacc >> 26)/lat_lng_scale - 90.0;
        msg->locations[i].lng = ((latlngacc >> 3) & 0x7fffff)/lat_lng_scale - 180.0;
        msg->locations[i].acc = accs[latlngacc & 0x7];
    }
    return 1;
}

static int parse_chat(struct message_chat *msg, uint8_t *payload, unsigned int len) {
    if (len < 7) return 0;
    if (payload[len-1] != '\0') return 0; // not null-terminated
    int nullchars = 0;
    for (int i=5; i<len; i++) if (payload[i] == '\0') nullchars++;
    if (nullchars != 1) return 0; // should have one null-terminated string
    if (!utf8_validate(payload+5)) return 0;

    msg->member = payload[0];
    msg->time = payload[1];
    for (int i=1; i<4; i++) {
        msg->time = (msg->time << 8) + payload[1+i];
    }
    msg->message = strdup((char *)(payload+5));
    if (!msg->message) {
        warn("%s", __func__);
        return 0;
    }
    return 1;
}

static int parse_magpi_form(struct message_magpi_form *msg, uint8_t *payload, unsigned int len) {
    if (len < 6) return 0;
    msg->member = payload[0];
    msg->time = payload[1];
    for (int i=1; i<4; i++) {
        msg->time = (msg->time << 8) + payload[1+i];
    }
    msg->length = len-5;
    msg->data = malloc(len-5);
    if (!msg->data) {
        warn("%s", __func__);
        return 0;
    }
    memcpy(msg->data, payload+5, len-5);
    return 1;
}

message_t parse_message(uint8_t *buf, unsigned int len) {
    message_t msg;
    msg.info.type = MSG_TYPE_ERROR;
    if (buf == NULL || len == 0) return msg;
    if (len < MSG_HDRLEN) {
        warnx("%s: len too short", __func__);
        return msg;
    }
    long payload_len = ((unsigned long) buf[1] << 8) + buf[2];
    if (len != MSG_HDRLEN + payload_len) {
        warnx("%s: len does not match payload length", __func__);
        return msg;
    }
    uint8_t type = buf[0];
    int okay;
    uint8_t *payload = buf+MSG_HDRLEN;
    switch (type) {
        case TEAM_START: okay = parse_team_start(&msg.data.team_start, payload, payload_len); break;
        case TEAM_END: okay = parse_team_end(&msg.data.team_end, payload, payload_len); break;
        case MEMBER_JOIN: okay = parse_member_join(&msg.data.member_join, payload, payload_len); break;
        case MEMBER_PART: okay = parse_member_part(&msg.data.member_part, payload, payload_len); break;
        case LOCATION: okay = parse_location(&msg.data.location, payload, payload_len); break;
        case CHAT: okay = parse_chat(&msg.data.chat, payload, payload_len); break;
        case MAGPI_FORM: okay = parse_magpi_form(&msg.data.magpi_form, payload, payload_len); break;
        default:
            warnx("%s: unknown message type (%d)", __func__, type);
            return msg;
    }
    if (!okay) {
        warnx("%s: error while parsing message of type %d", __func__, type);
        return msg;
    }
    msg.info.type = type;
    msg.info.length = payload_len;
    return msg;
}

message_t new_chat_message(member_pos sender, rel_epoch epoch, char *message) {
    message_t msg;
    msg.info.type = MSG_TYPE_ERROR;
    if (!message || message[0] == '\0') return msg;
    if (strlen(message)+4 > MSG_MAX_PAYLOAD) {
        warnx("%s: message is too long", __func__);
        return msg;
    }
    if (!utf8_validate((uint8_t *) message)) {
        warnx("%s: message is not valid utf8", __func__);
        return msg;
    }
    message = strdup(message);
    if (!message) {
        warn("%s", __func__);
        return msg;
    }
    msg.info.type = CHAT;
    msg.info.length = strlen(message)+4;
    msg.data.chat.member = sender;
    msg.data.chat.time = epoch;
    msg.data.chat.message = message;
    return msg;
}

int write_message(FILE *out, message_t msg) {
    // check msg validity
    if (msg.info.type < 0 || msg.info.type > MSG_TYPE_MAX) return 0;
    switch (msg.info.type) {
        case CHAT:
            if (!msg.data.chat.message) {
                warnx("%s: chat message is null", __func__);
                return 0;
            } else if (strlen(msg.data.chat.message)+4 != msg.info.length) {
                warnx("%s: chat message length does not match data", __func__);
                return 0;
            }
            break;
        default:
            warnx("%s: unimplemented for message type (%d)", __func__, msg.info.type);
            return 0;
    }

    unsigned int length = msg.info.length;
    uint8_t *buf = malloc(length);
    if (!buf) {
        warn("%s", __func__);
        return 0;
    }

    switch (msg.info.type) {
        case CHAT:
            buf[0] = msg.data.chat.member;
            buf[1] = msg.data.chat.time >> 8;
            buf[2] = msg.data.chat.time & 0xff;
            memcpy(buf+3, msg.data.chat.message, length-3);
            break;
        default:
            return 0;
    }

    if (fwrite(buf, 1, length, out) != length) {
        warn("%s", __func__);
        return 0;
    }
    return length;
}

void free_message(message_t msg) {
    switch (msg.info.type) {
        case TEAM_START:
            free(msg.data.team_start.name);
            break;
        case TEAM_END:
            break;
        case MEMBER_JOIN:
            free(msg.data.member_join.name);
            free(msg.data.member_join.id);
            break;
        case MEMBER_PART:
            break;
        case LOCATION:
            free(msg.data.location.locations);
            break;
        case CHAT:
            free(msg.data.chat.message);
            break;
        case MAGPI_FORM:
            free(msg.data.magpi_form.data);
            break;
        default:
            break;
    }
}

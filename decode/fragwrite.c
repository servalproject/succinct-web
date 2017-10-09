#include <stdio.h>
#include <err.h>
#include <unistd.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <assert.h>
#include "fragment.h"
#include "message.h"

static uint8_t msgbuf[MSG_MAXLEN+1];

static void write_fragment_header(FILE *fp, uint8_t *teamid, uint32_t seq, uint8_t offset);

int main(int argc, char *argv[]) {
    if (argc != 7) {
        fprintf(stderr, "Usage: fragwrite dir teamid seqstart mtu msgtype msgfile\n");
        return 2;
    }
    char *dir = argv[1];
    char *team = argv[2];
    char *seqstart = argv[3];
    char *mtu_s = argv[4];
    char *msgtype_s = argv[5];
    char *msgfilename = argv[6];

    FILE *msgfile = fopen(msgfilename, "r");
    if (!msgfile) err(1, "%s", msgfilename);

    if (chdir(dir) != 0) err(1, "%s", dir);

    if (strlen(team) != 2*TEAMLEN) errx(1, "%s: team name wrong length", team);
    uint8_t teamid[TEAMLEN];
    for (int i=0; i<TEAMLEN; i++) {
        teamid[i] = 0;
        for (int j=0; j<2; j++) {
            uint8_t val = 0;
            switch (team[2*i+j]) {
                case 'f': val++; case 'e': val++; case 'd': val++; case 'c': val++;
                case 'b': val++; case 'a': val++; case '9': val++; case '8': val++;
                case '7': val++; case '6': val++; case '5': val++; case '4': val++;
                case '3': val++; case '2': val++; case '1': val++; case '0': break;
                default: errx(1, "%s: invalid team name", team);
            }
            teamid[i] += (j == 0) ? (val << 4) : val;
        }
    }

    int64_t seq = parse_seq(seqstart);
    if (seq < 0) errx(1, "%s: invalid sequence number", seqstart);

    if (mtu_s[0] == '\0') errx(1, "empty mtu");
    char *end = NULL;
    long int mtu = strtol(mtu_s, &end, 10);
    if (end[0] != '\0' || mtu <= FRAGHDRLEN || mtu > UINT16_MAX) {
        errx(1, "%s: invalid mtu or out of range", mtu_s);
    }

    if (msgtype_s[0] == '\0') errx(1, "empty message type");
    end = NULL;
    long int msgtype = strtol(msgtype_s, &end, 10);
    if (end[0] != '\0' || msgtype < 0 || msgtype > MSG_TYPE_MAX) {
        errx(1, "%s: invalid message type", msgtype_s);
    }

    size_t payload = fread(msgbuf+MSG_HDRLEN, 1, MSG_MAX_PAYLOAD+1, msgfile);
    if (ferror(msgfile)) err(1, "%s", msgfilename);
    if (payload == 0) warnx("warning: %s: message has zero length", msgfilename);
    if (payload > MSG_MAX_PAYLOAD) errx(1, "%s: message too long", msgfilename);
    fclose(msgfile);

    msgbuf[0] = msgtype;
    msgbuf[1] = payload >> 8;
    msgbuf[2] = payload & 0xff;
    long int msglen = MSG_HDRLEN + payload;

    /* ensure next sequence number is free */
    while (1) {
        char *next = format_seq(seq+1);
        if (!next) return 1;
        int ac = access(next, F_OK);
        free(next);
        if (ac != 0) break;
        seq++;
    }

    char *seqstr = format_seq(seq);
    if (!seqstr) return 1;

    int rawoffset = -1;

    FILE *fragment = fopen(seqstr, "a+");
    if (!fragment) err(1, "%s", seqstr);
    if (fseek(fragment, 0, SEEK_END) != 0) err(1, "%s", seqstr);
    long int len = ftell(fragment);
    if (len >= FRAGHDRLEN) {
        rawoffset = fragment_file_read_raw_offset(fragment);
        if (rawoffset < 0) errx(1, "%s: could not read offset", seqstr);
    } else {
        rawoffset = -1;
    }

    while (rawoffset == 255 || len >= mtu) {
        fclose(fragment);
        free(seqstr);
        if (seq == UINT32_MAX) errx(1, "hit maximum sequence number");
        seqstr = format_seq(++seq);
        if (!seqstr) return 1;
        fragment = fopen(seqstr, "a+");
        if (!fragment) err(1, "%s", seqstr);
        if (fseek(fragment, 0, SEEK_END) != 0) err(1, "%s", seqstr);
        len = ftell(fragment);
        if (len >= FRAGHDRLEN) {
            rawoffset = fragment_file_read_raw_offset(fragment);
            if (rawoffset < 0) errx(1, "%s: could not read offset", seqstr);
        } else {
            rawoffset = -1;
        }
    }

    if (len > 0 && len <= FRAGHDRLEN) {
        errx(1, "%s: existing fragment has invalid length", seqstr);
    }

    if (len == 0) {
        len = FRAGHDRLEN;
        int offset = 0;
        fprintf(stderr, "info: writing header to %s (offset %d)\n", seqstr, offset);
        write_fragment_header(fragment, teamid, seq, offset);
    }

    int remaining = msglen;
    int available = mtu-len;

    while (1) {
        int towrite = (remaining < available) ? remaining : available;
        fprintf(stderr, "info: writing %d bytes to %s\n", towrite, seqstr);
        if (fwrite(msgbuf+(msglen-remaining), 1, towrite, fragment) != towrite) {
            err(1, "%s", seqstr);
        }
        remaining -= towrite;
        available -= towrite;

        if (remaining == 0) break;

        if (available == 0) {
            fclose(fragment);
            free(seqstr);
            if (seq == UINT32_MAX) errx(1, "hit maximum sequence number");
            seqstr = format_seq(++seq);
            if (!seqstr) return 1;
            fragment = fopen(seqstr, "a+");
            if (!fragment) err(1, "%s", seqstr);
            if (fseek(fragment, 0, SEEK_END) != 0) err(1, "%s", seqstr);
            if (ftell(fragment) != 0) errx(1, "%s: unexpected file", seqstr);
            available = mtu-FRAGHDRLEN;
            int offset = (remaining < available) ? remaining : available;
            if (offset > 255) offset = 255;
            fprintf(stderr, "info: writing header to %s (offset %d)\n", seqstr, offset);
            write_fragment_header(fragment, teamid, seq, offset);
        }
    }

    fclose(fragment);
}

static void write_fragment_header(FILE *fp, uint8_t *teamid, uint32_t seq, uint8_t offset) {
    if (fwrite(teamid, 1, TEAMLEN, fp) != TEAMLEN) err(1, "fragment %d", seq);
    static_assert(SEQLEN == 4, "SEQLEN must be 4");
    uint8_t seqbytes[SEQLEN];
    seqbytes[0] = (seq >> 24) & 0xff;
    seqbytes[1] = (seq >> 16) & 0xff;
    seqbytes[2] = (seq >> 8)  & 0xff;
    seqbytes[3] = (seq >> 0)  & 0xff;
    if (fwrite(seqbytes, 1, SEQLEN, fp) != SEQLEN) err(1, "fragment %d", seq);
    static_assert(OFFSETLEN == 1, "OFFSETLEN must be 1");
    if (fwrite(&offset, 1, OFFSETLEN, fp) != OFFSETLEN) err(1, "fragment %d", seq);
}

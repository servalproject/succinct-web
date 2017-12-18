#include <stdio.h>
#include <err.h>
#include <stdint.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include "fragment.h"
#include "message.h"
#include "ccan/json/json.h"

static uint8_t message[MSG_MAXLEN];
static const char utf8hex[16] = u8"0123456789abcdef";

int main(int argc, char *argv[]) {
    if (argc != 8) {
        fprintf(stderr, "Usage: process_fragment teamid directory seq msgnum msgfile jsonfile magpifile\n");
        return 2;
    }
    char *teamidl = argv[1];
    char *dir = argv[2];
    char *seqstr = argv[3];
    char *msgnum = argv[4];
    char *msgfile = argv[5];
    char *jsonfile = argv[6];
    char *magpifile = argv[7];

    if (chdir(dir) != 0) err(1, "%s: chdir", dir);

    /* check team id and convert to UTF8 if it's not already */
    char teamid[2*TEAMLEN+1];
    for (int i=0; i<2*TEAMLEN; i++) {
        uint8_t val = 0;
        switch (teamidl[i]) {
            case 'f': case 'F': val++; case 'e': case 'E': val++;
            case 'd': case 'D': val++; case 'c': case 'C': val++;
            case 'b': case 'B': val++; case 'a': case 'A': val++;
            case '9': val++; case '8': val++; case '7': val++; case '6': val++;
            case '5': val++; case '4': val++; case '3': val++; case '2': val++;
            case '1': val++; case '0': break;
            default: errx(1, "%s: invalid team name", teamidl);
        }
        teamid[i] = utf8hex[val];
    }
    if (teamidl[2*TEAMLEN] != '\0') errx(1, "%s: invalid team name", teamidl);
    teamid[2*TEAMLEN] = '\0';

    int64_t seq = parse_seq(seqstr);
    if (seq < 0) errx(1, "%s: invalid sequence number", seqstr);

    if (msgnum[0] == '\0') errx(1, "empty message number");
    char *msgend = NULL;
    long int n = strtol(msgnum, &msgend, 10);
    if (msgend[0] != '\0' || n <= 0 || n > FRAGMENT_MAX_MESSAGES) {
        errx(1, "%s: invalid message number", msgnum);
    }

    long length = fragments_extract_message(seq, n, message, NULL);
    if (!length) {
        errx(1, "could not extract message %s/%s", seqstr, msgnum);
    }

    FILE *out;
    if (strcmp(msgfile,"-")==0)
        out = stdout;
    else{
        out = fopen(msgfile, "w");
        if (!out)
            errx(1, "could not open %s", msgfile);
    }
    fwrite(message, 1, length, out);
    if (out != stdout)
        fclose(out);

    message_t msg = parse_message(message, length);
    if (msg.info.type == MSG_TYPE_ERROR) {
        errx(1, "%s: malformed message", msgfile);
    }

    if (msg.info.type == MAGPI_FORM){
        if (strcmp(magpifile,"-")==0)
            out = stdout;
        else{
            out = fopen(magpifile,"w");
            if (!out)
                errx(1, "could not open %s", magpifile);
        }
        fwrite(msg.data.magpi_form.data, 1, msg.data.magpi_form.length, out);
        if (out != stdout)
           fclose(out);
    }

    JsonNode *root = json_mkobject();
    int r = message_to_json(teamid, msg, root);
    if (r==0){
        if (strcmp(jsonfile,"-")==0)
            out = stdout;
        else{
            out = fopen(jsonfile,"w");
            if (!out)
                errx(1, "could not open %s", jsonfile);
        }
        fputs(json_encode(root), out);
        fputc('\n', out);
        if (out != stdout)
            fclose(out);
    }
    json_delete(root);

    return 0;
}

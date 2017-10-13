#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <ctype.h>
#include <err.h>
#include "fragment.h"
#include "message.h"
#include "ccan/json/json.h"

static uint8_t buf[MSG_MAXLEN+1];
static const char utf8hex[16] = u8"0123456789abcdef";

int main(int argc, char *argv[]) {
    if (argc != 3) {
        fprintf(stderr, "Usage: message_to_json teamid messagefile\n");
        return 2;
    }
    char *teamidl = argv[1];
    char *msgfile = argv[2];

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

    FILE *fp = fopen(msgfile, "r");
    if (!fp) err(1, "%s: open", msgfile);

    size_t size = fread(buf, 1, MSG_MAXLEN+1, fp);
    if (ferror(fp)) err(1, "%s", msgfile);
    if (size < MSG_HDRLEN) errx(1, "%s: message file too short", msgfile);
    if (size > MSG_MAXLEN) errx(1, "%s: message file too long", msgfile);
    fclose(fp);

    message_t msg = parse_message(buf, size);
    if (msg.info.type == MSG_TYPE_ERROR) {
        errx(1, "%s: malformed message", msgfile);
    }

    JsonNode *root = json_mkobject();
    json_append_member(root, "team", json_mkstring(teamid));

    switch (msg.info.type) {
        case TEAM_START:
            json_append_member(root, "type", json_mkstring("start"));
            json_append_member(root, "time", json_mknumber(msg.data.team_start.time));
            json_append_member(root, "name", json_mkstring(msg.data.team_start.name));
            break;
        case TEAM_END:
            json_append_member(root, "type", json_mkstring("end"));
            json_append_member(root, "time", json_mknumber(msg.data.team_end.time));
            break;
        case MEMBER_JOIN:
            json_append_member(root, "type", json_mkstring("join"));
            json_append_member(root, "member", json_mknumber(msg.data.member_join.member));
            json_append_member(root, "reltime", json_mknumber(100.0*msg.data.member_join.time));
            json_append_member(root, "name", json_mkstring(msg.data.member_join.name));
            json_append_member(root, "id", json_mkstring(msg.data.member_join.id));
            break;
        case MEMBER_PART:
            json_append_member(root, "type", json_mkstring("part"));
            json_append_member(root, "member", json_mknumber(msg.data.member_part.member));
            json_append_member(root, "reltime", json_mknumber(100.0*msg.data.member_part.time));
            break;
        case LOCATION:
            json_append_member(root, "type", json_mkstring("location"));
            JsonNode *locations = json_mkarray();
            for (int i=0; i < msg.data.location.length; i++) {
                JsonNode *obj = json_mkobject();
                member_location location = msg.data.location.locations[i];
                json_append_member(obj, "member", json_mknumber(location.member));
                json_append_member(obj, "reltime", json_mknumber(100.0*location.time));
                json_append_member(obj, "lat", json_mknumber(location.lat));
                json_append_member(obj, "lng", json_mknumber(location.lng));
                json_append_member(obj, "acc", json_mknumber(location.acc));
                json_append_element(locations, obj);
            }
            json_append_member(root, "locations", locations);
            break;
        case CHAT:
            json_append_member(root, "type", json_mkstring("chat"));
            json_append_member(root, "member", json_mknumber(msg.data.chat.member));
            json_append_member(root, "reltime", json_mknumber(100.0*msg.data.chat.time));
            json_append_member(root, "message", json_mkstring(msg.data.chat.message));
            break;
        case MAGPI_FORM:
            json_append_member(root, "type", json_mkstring("magpi-form"));
            json_append_member(root, "member", json_mknumber(msg.data.magpi_form.member));
            json_append_member(root, "reltime", json_mknumber(100.0*msg.data.magpi_form.time));
            char *hexdata = malloc(2*msg.data.magpi_form.length+1);
            if (!hexdata) err(1, "malloc");
            for (int i=0; i<msg.data.magpi_form.length; i++) {
                uint8_t byte = msg.data.magpi_form.data[i];
                hexdata[2*i+0] = utf8hex[byte >> 4];
                hexdata[2*i+1] = utf8hex[byte & 0xf];
            }
            hexdata[2*msg.data.magpi_form.length] = '\0';
            json_append_member(root, "hexdata", json_mkstring(hexdata));
            free(hexdata);
            break;
        default:
            errx(1, "uknown message type (%d)", msg.info.type);
    }

    printf("%s\n", json_encode(root));
    json_delete(root);

    return 0;
}

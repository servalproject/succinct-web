CC=gcc
CFLAGS=-Wall -pedantic -std=gnu11

all: place_fragment fraginfo fragextract fragwrite message_to_json chatmsg

place_fragment: decode.o fragment.o place_fragment.c
	$(CC) -o $@ $^ $(CFLAGS) $(CPPFLAGS)

fraginfo: fragment.o message.o fraginfo.c
	$(CC) -o $@ $^ $(CFLAGS) $(CPPFLAGS)

fragextract: fragment.o message.o fragextract.c
	$(CC) -o $@ $^ $(CFLAGS) $(CPPFLAGS)

fragwrite: fragment.o message.o fragwrite.c
	$(CC) -o $@ $^ $(CFLAGS) $(CPPFLAGS)

message_to_json: message.o fragment.o ccan/json/json.o message_to_json.c
	$(CC) -o $@ $^ $(CLFAGS) $(CPPFLAGS)

chatmsg: message.o fragment.o chatmsg.c
	$(CC) -o $@ $^ $(CLFAGS) $(CPPFLAGS)

CC=gcc
CFLAGS=-Wall -pedantic -std=gnu11

all: place_fragment

place_fragment: decode.o fragment.o place_fragment.c
	$(CC) -o $@ $^ $(CFLAGS) $(CPPFLAGS)

#!/bin/bash

((EUID==0)) || { echo "Run this script as root e.g. sudo" "$@"; exit 2; }

apt-get install apache2

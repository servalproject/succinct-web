#!/bin/bash

((EUID==0)) || { echo "Run this script as root e.g. sudo" "$@"; exit 2; }

set -x

cd $(dirname "$0")

apt-get install -y apache2

a2enmod proxy_wstunnel
service apache2 restart

curl -sL https://deb.nodesource.com/setup_8.x | bash -
apt-get install -y nodejs

adduser --system --home /srv/succinct --group succinct

cp -a ../www /srv/succinct
chown -R succinct:succinct /srv/succinct/www

cp apache/succinct.conf /etc/apache2/sites-available

a2dissite 000-default
a2ensite succinct
service apache2 reload

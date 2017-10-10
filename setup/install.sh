#!/bin/bash

[ -f /sys/hypervisor/uuid ] && [ "$(head -c 3 /sys/hypervisor/uuid)" = "ec2" ] \
    || { echo "This script is intended to be run on an EC2 instance"; exit 2; }

source /etc/os-release || exit 1
[[ $ID = 'ubuntu' ]] || { echo "This script is intended for EC2 ubuntu instances"; exit 2; }

((EUID==0)) || { echo "Run this script as root e.g. sudo" "$@"; exit 2; }

cd $(dirname "$0")

set -x

SUCCINCT_HOME=/srv/succinct
SSH_USER=ubuntu

apt-get install -y git
apt-get install -y apache2
apt-get install -y php7.0 php7.0-cli php7.0-fpm php7.0-curl php7.0-json php7.0-mysql php7.0-mcrypt
apt-get install -y mariadb-server
apt-get install -y build-essential

curl -sL https://deb.nodesource.com/setup_8.x | bash -
apt-get install -y nodejs

adduser --system --home $SUCCINCT_HOME --group succinct
usermod -a -G succinct $SSH_USER

cat > /etc/apache2/sites-available/succinct.conf << EOF
<VirtualHost *:80>
	ServerAdmin webmaster@localhost
	DocumentRoot $SUCCINCT_HOME/www
	ErrorLog \${APACHE_LOG_DIR}/succinct-error.log
	CustomLog \${APACHE_LOG_DIR}/succinct-access.log combined

    <Directory $SUCCINCT_HOME/www>
        Options FollowSymLinks
        AllowOverride None
        Require all granted
    </Directory>

    <Directory $SUCCINCT_HOME/www/succinct/api>
        AllowOverride All
    </Directory>

	ProxyPass "/eoc-ws/" "ws://127.0.0.1:3000/"
</VirtualHost>
EOF

mkdir $SUCCINCT_HOME/www
chown succinct:succinct $SUCCINCT_HOME/www

git init --bare --shared=group $SUCCINCT_HOME/git
cat > $SUCCINCT_HOME/git/hooks/post-receive << EOF
#!/bin/bash
[ -x $SUCCINCT_HOME/setup/post-receive ] && exec sudo -H -u succinct $SUCCINCT_HOME/setup/post-receive "\$@"
# fall-back on simple checkout
while read oldrev newrev ref; do
    branch=\$(basename "\$ref")
    [[ \$branch = live ]] || continue
    sudo -u succinct git --work-tree=$SUCCINCT_HOME --git-dir=$SUCCINCT_HOME/git checkout -f "\$branch"
    [ -x $SUCCINCT_HOME/setup/post-receive ] && echo "\$oldrev \$newrev \$ref" | sudo -H -u succinct $SUCCINCT_HOME/setup/post-receive "\$@"
done
EOF
chmod +x $SUCCINCT_HOME/git/hooks/post-receive
chown -R $SSH_USER:succinct $SUCCINCT_HOME/git

mkdir -p $SUCCINCT_HOME/spool/tmp
chown -R succinct:succinct $SUCCINCT_HOME/spool

mkdir $SUCCINCT_HOME/log
chown -R succinct:succinct $SUCCINCT_HOME/log

mysql < <<EOF
grant all on ramp.* to 'ramp'@'localhost';
create database ramp;
EOF

a2enmod proxy_fcgi
a2enmod proxy_wstunnel
a2enmod rewrite
a2enconf php7.0-fpm
a2dissite 000-default
a2ensite succinct

sed -i 's/user = www-data/user = succinct/' /etc/php/7.0/fpm/pool.d/www.conf

service php7.0-fpm restart
service apache2 restart

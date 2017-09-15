CREATE TABLE teams (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    uuid CHAR(36) NOT NULL,
    name CHAR(50) CHARACTER SET utf8 NOT NULL,
    started TIMESTAMP NOT NULL DEFAULT 0,
    finished TIMESTAMP NULL DEFAULT NULL,
    rockid CHAR(50), /* todo not sure how long this should be */
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated TIMESTAMP DEFAULT 0 ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(id),
    INDEX(finished)
) ENGINE=Aria, ROW_FORMAT=FIXED;

CREATE TABLE members (
    team INT UNSIGNED NOT NULL,
    member_id SMALLINT UNSIGNED NOT NULL,
    name CHAR(100) CHARACTER SET utf8 NOT NULL,
    identity CHAR(100) CHARACTER SET utf8 NOT NULL,
    joined TIMESTAMP NOT NULL DEFAULT 0,
    parted TIMESTAMP NULL DEFAULT NULL,
    last_location INT UNSIGNED,
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated TIMESTAMP DEFAULT 0 ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(team, member_id)
) ENGINE=Aria, ROW_FORMAT=FIXED;

CREATE TABLE locations (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    team INT UNSIGNED NOT NULL,
    member_id SMALLINT UNSIGNED NOT NULL,
    time TIMESTAMP NOT NULL DEFAULT 0,
    lat FLOAT NOT NULL,
    lng FLOAT NOT NULL,
    accuracy SMALLINT UNSIGNED,
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated TIMESTAMP DEFAULT 0 ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(id),
    INDEX(team, member_id, time)
) ENGINE=Aria, ROW_FORMAT=FIXED;

CREATE TABLE chat (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    team INT UNSIGNED NOT NULL,
    time TIMESTAMP(3) NOT NULL DEFAULT 0,
    sender INT UNSIGNED NOT NULL,
    message VARCHAR(1000) CHARACTER SET utf8 NOT NULL,
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated TIMESTAMP DEFAULT 0 ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(id),
    INDEX(team, time)
) ENGINE=Aria;
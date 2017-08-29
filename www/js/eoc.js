var map = L.map('map', {attributionControl: false}).setView([-34.929, 138.601], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
var marker = L.marker([-34.9, 138.6]).addTo(map);

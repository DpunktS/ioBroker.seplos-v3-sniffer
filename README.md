![Logo](admin/seplos-v3-sniffer.jpg)
# ioBroker.seplos-v3-sniffer

[![NPM version](https://img.shields.io/npm/v/iobroker.seplos-v3-sniffer.svg)](https://www.npmjs.com/package/iobroker.seplos-v3-sniffer)
[![Downloads](https://img.shields.io/npm/dm/iobroker.seplos-v3-sniffer.svg)](https://www.npmjs.com/package/iobroker.seplos-v3-sniffer)
![Number of Installations](https://iobroker.live/badges/seplos-v3-sniffer-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/seplos-v3-sniffer-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.seplos-v3-sniffer.png?downloads=true)](https://nodei.co/npm/iobroker.seplos-v3-sniffer/)

**Tests:** ![Test and Release](https://github.com/DpunktS/ioBroker.seplos-v3-sniffer/workflows/Test%20and%20Release/badge.svg)

## seplos-v3-sniffer adapter for ioBroker

Dieser Adapter wurde entwickelt, um das Seplos V3 BMS in einer Multipack-Konfiguration auszulesen. Bei der V3-Generation fungiert das erste BMS als Modbus-Master, während alle anderen BMS als Slaves agieren. In dieser Konstellation ist es nicht mehr möglich, das BMS über Modbus von einem dritten Gerät aus anzusprechen, da in einem RS-485 Modbus-System keine zwei Master-Geräte existieren dürfen. Der Adapter erfasst die Kommunikation zwischen den Geräten passiv, wodurch die Kommunikation der einzelnen BMS nicht gestört wird. Er kann entweder über eine lokale Schnittstelle (z.B. ttyS0) oder über Ser2Net (tcp://ip:2001) kommunizieren. 

![seplos 4x](https://github.com/user-attachments/assets/9d710287-069d-44b6-acda-e96764642a33)

![pinout](https://github.com/user-attachments/assets/1c8ec271-d20f-4a5d-baf4-87e5a98fc35a)

Die Ser2Net-Verbindung wurde mit ESPHome getestet.
```
external_components:
  - source: github://oxan/esphome-stream-server

uart:
- id: seplos
  tx_pin: GPIO17
  rx_pin: GPIO16
  baud_rate: 19200
  rx_buffer_size: 2048

stream_server:
   uart_id: seplos
   port: 2001
   buffer_size: 2048
```

## Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
* (DpunktS) initial release

## License
MIT License

Copyright (c) 2025 DpunktS <leer@leer.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

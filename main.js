'use strict';

const { SerialPort } = require('serialport');
const net = require('net');
const utils = require('@iobroker/adapter-core');

class SeplosV3Sniffer extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: 'seplos-v3-sniffer',
        });

        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.knownIds = []; // Optimierung für setObjectNotExists
        this.serialPort = null;
        this.socket = null;
        this.buffer = [];
        this.lastUpdate = {};
        this.updateInterval = 5000; // Standardwert 5 Sekunden
        this.reconnectTimeout = null; // Timeout für TCP-Reconnect
        this.lastDataReceived = Date.now(); // Letzte empfangene Daten
        this.dataTimeout = 10000; // Timeout für Datenprüfung (10 Sekunden)
        this.dataCheckInterval = null; // Intervall für Datenprüfung
        this.isShuttingDown = false;
    }

    async onReady() {
        const serialAdapter = this.config['serial adapter'] || '/dev/ttyS0';
        this.updateInterval = (Number(this.config['update_interval']) || 5) * 1000;

        // Reset the connection indicator during startup
        this.setState('info.connection', false, true);

        if (!this.validateSerialAdapter(serialAdapter)) {
            this.log.error(
                `Invalid input for the serial adapter: "${serialAdapter}". Please enter a valid address (tcp://ip:port, tcp://name.de:port, /dev/tty*, COM*).`,
            );
            return; // Prevents the adapter from crashing
        }

        this.log.info(`Using serial adapter: ${serialAdapter}`);
        this.log.info(`Update interval set to: ${this.updateInterval / 1000} seconds`);

        if (serialAdapter.startsWith('tcp://')) {
            this.log.info('Using TCP connection for serial data');
            await this.connectTcp(serialAdapter);
        } else {
            await this.connectSerial(serialAdapter);
        }
        // Intervall zur Überprüfung der Daten
        this.dataCheckInterval = this.setInterval(() => {
            if (Date.now() - this.lastDataReceived > this.dataTimeout) {
                this.setState('info.connection', false, true);
            }
        }, 5000);
    }

    validateSerialAdapter(serialAdapter) {
        const tcpRegex = /^tcp:\/\/([a-zA-Z0-9.-]+):(\d+)$/; // tcp://ip:port oder tcp://name.de:port
        const devTtyRegex = /^\/dev\/tty[A-Za-z0-9]+$/; // /dev/tty*
        const comRegex = /^COM\d+$/; // COM*

        return tcpRegex.test(serialAdapter) || devTtyRegex.test(serialAdapter) || comRegex.test(serialAdapter);
    }

    async connectTcp(serialAdapter) {
        try {
            const [, host, port] = serialAdapter.match(/tcp:\/\/(.*):(\d+)/);
            this.log.info(`Connecting to TCP serial: ${host}:${port}`);

            this.socket = new net.Socket();
            this.socket.connect(parseInt(port), host, () => {
                this.log.info(`Connected to ${host}:${port}`);
            });

            this.socket.on('data', data => {
                this.processStream(data);
            });

            this.socket.on('error', err => {
                this.log.error(`TCP connection error: ${err.message}`);
            });

            this.socket.on('close', () => {
                this.log.warn('TCP connection closed, retrying...');
                //setTimeout(() => this.connectTcp(serialAdapter), 5000);
                if (this.reconnectTimeout) {
                    this.clearTimeout(this.reconnectTimeout);
                }
                this.reconnectTimeout = this.setTimeout(() => this.connectTcp(serialAdapter), 5000);
            });
        } catch (error) {
            this.log.error(`TCP connection failed: ${error.message}`);
        }
    }

    async connectSerial(serialAdapter) {
        try {
            this.serialPort = new SerialPort({
                path: serialAdapter,
                baudRate: 19200,
            });

            this.serialPort.on('data', data => {
                this.processStream(data);
            });

            this.serialPort.on('error', err => {
                this.log.error(`Serial port error: ${err.message}`);
            });
        } catch (error) {
            this.log.error(`Failed to open serial port: ${error.message}`);
        }
    }

    processStream(data) {
        for (const byte of data) {
            this.buffer.push(byte);

            if (this.buffer.length >= 5) {
                if (!this.isValidHeader(this.buffer)) {
                    this.buffer.shift();
                    continue;
                }

                const expectedLength = this.getExpectedLength(this.buffer);
                if (this.buffer.length >= expectedLength) {
                    if (this.validateCRC(this.buffer, expectedLength)) {
                        this.processPacket(Buffer.from(this.buffer.slice(0, expectedLength)));
                    }
                    this.buffer = [];
                }
            }
        }
    }

    async onUnload(callback) {
        try {
            this.isShuttingDown = true; // Set shutdown flag
            this.log.info('Cleaning up before shutdown...');
            this.buffer = [];
            this.lastUpdate = {};
            if (this.serialPort) {
                this.log.info('Closing serial connection...');
                this.serialPort.close();
                this.serialPort = null;
            }
            if (this.socket) {
                this.log.info('Closing TCP connection...');
                this.socket.destroy();
                this.socket = null;
            }
            if (this.reconnectTimeout) {
                this.clearTimeout(this.reconnectTimeout);
                this.reconnectTimeout = null;
            }
            if (this.dataCheckInterval) {
                this.clearInterval(this.dataCheckInterval);
                this.dataCheckInterval = null;
            }
            this.knownIds = []; // Leeren der bekannten IDs
            this.setState('info.connection', false, true);
            this.log.info('Shutdown complete.');

            callback();
        } catch (error) {
            this.log.error(`Error during unload: ${error.message}`);
            callback();
        }
    }

    isValidHeader(buffer) {
        return (
            buffer[0] >= 0x01 && buffer[0] <= 0x10 && buffer[1] === 0x04 && (buffer[2] === 0x24 || buffer[2] === 0x34)
        );
    }

    getExpectedLength(buffer) {
        return buffer[2] === 0x24 ? 41 : 57;
    }

    validateCRC(buffer, length) {
        const receivedCRC = (buffer[length - 1] << 8) | buffer[length - 2];
        const calculatedCRC = this.calculateModbusCRC(buffer.slice(0, length - 2));
        return receivedCRC === calculatedCRC;
    }

    calculateModbusCRC(data) {
        let crc = 0xffff;
        for (let i = 0; i < data.length; i++) {
            crc ^= data[i];
            for (let j = 0; j < 8; j++) {
                if (crc & 0x0001) {
                    crc = (crc >> 1) ^ 0xa001;
                } else {
                    crc >>= 1;
                }
            }
        }
        return crc;
    }

    async ensureObjectExists(id, { type, common, native = {} }) {
        if (this.isShuttingDown || this.knownIds.includes(id)) {
            return; // Nichts tun, wenn das Objekt bereits existiert oder das System herunterfährt
        }
        try {
            await this.setObjectNotExistsAsync(id, {
                type,
                common,
                native,
            });
            this.knownIds.push(id);
        } catch (err) {
            this.log.error(`Error creating state ${id}: ${err.message}`);
        }
    }

    async processPacket(buffer) {
        const bmsIndex = buffer[0] - 0x01;
        const bmsFolder = `bms_${bmsIndex}`;

        if (bmsIndex === 0) {
            this.lastDataReceived = Date.now();
            this.setState('info.connection', true, true);
        }

        // Stelle sicher, dass der BMS-Ordner existiert
        await this.ensureObjectExists(bmsFolder, {
            type: 'channel',
            common: { name: `bms ${bmsIndex}` },
            native: {},
        });

        const now = Date.now();
        let updates = {};

        if (buffer[2] === 0x24) {
            updates = {
                [`${bmsFolder}.pack_voltage`]: {
                    value: buffer.readUInt16BE(3) / 100.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.current`]: {
                    value: buffer.readInt16BE(5) / 100.0,
                    unit: 'A',
                    role: 'value.current',
                    ctype: 'number',
                },
                [`${bmsFolder}.remaining_capacity`]: {
                    value: buffer.readUInt16BE(7) / 100.0,
                    unit: 'Ah',
                    role: 'value',
                    ctype: 'number',
                },
                [`${bmsFolder}.total_capacity`]: {
                    value: buffer.readUInt16BE(9) / 100.0,
                    unit: 'AH',
                    role: 'value',
                    ctype: 'number',
                },
                [`${bmsFolder}.total_discharge_capacity`]: {
                    value: buffer.readUInt16BE(11) / 0.1,
                    unit: 'AH',
                    role: 'value',
                    ctype: 'number',
                },
                [`${bmsFolder}.soc`]: {
                    value: buffer.readUInt16BE(13) / 10.0,
                    unit: '%',
                    role: 'value',
                    ctype: 'number',
                },
                [`${bmsFolder}.soh`]: {
                    value: buffer.readUInt16BE(15) / 10.0,
                    unit: '%',
                    role: 'value',
                    ctype: 'number',
                },
                [`${bmsFolder}.cycle_count`]: {
                    value: buffer.readUInt16BE(17),
                    unit: 'cycles',
                    role: 'value',
                    ctype: 'number',
                },
                [`${bmsFolder}.average_cell_voltage`]: {
                    value: buffer.readUInt16BE(19) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.average_cell_temp`]: {
                    value: buffer.readInt16BE(21) / 10.0 - 273.15,
                    unit: '°C',
                    role: 'value.temperature',
                    ctype: 'number',
                },
                [`${bmsFolder}.max_cell_voltage`]: {
                    value: buffer.readUInt16BE(23) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.min_cell_voltage`]: {
                    value: buffer.readUInt16BE(25) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.max_cell_temp`]: {
                    value: buffer.readUInt16BE(27) / 10.0 - 273.15,
                    unit: '°C',
                    role: 'value.temperature',
                    ctype: 'number',
                },
                [`${bmsFolder}.min_cell_temp`]: {
                    value: buffer.readUInt16BE(29) / 10.0 - 273.15,
                    unit: '°C',
                    role: 'value.temperature',
                    ctype: 'number',
                },
                [`${bmsFolder}.maxdiscurt`]: {
                    value: buffer.readUInt16BE(33) / 1.0,
                    unit: 'A',
                    role: 'value.current',
                    ctype: 'number',
                },
                [`${bmsFolder}.maxchgcurt`]: {
                    value: buffer.readUInt16BE(35) / 1.0,
                    unit: 'A',
                    role: 'value.current',
                    ctype: 'number',
                },
            };
        } else if (buffer[2] === 0x34) {
            updates = {
                [`${bmsFolder}.cell_1_voltage`]: {
                    value: buffer.readUInt16BE(3) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_2_voltage`]: {
                    value: buffer.readUInt16BE(5) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_3_voltage`]: {
                    value: buffer.readUInt16BE(7) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_4_voltage`]: {
                    value: buffer.readUInt16BE(9) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_5_voltage`]: {
                    value: buffer.readUInt16BE(11) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_6_voltage`]: {
                    value: buffer.readUInt16BE(13) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_7_voltage`]: {
                    value: buffer.readUInt16BE(15) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_8_voltage`]: {
                    value: buffer.readUInt16BE(17) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_9_voltage`]: {
                    value: buffer.readUInt16BE(19) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_10_voltage`]: {
                    value: buffer.readUInt16BE(21) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_11_voltage`]: {
                    value: buffer.readUInt16BE(23) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_12_voltage`]: {
                    value: buffer.readUInt16BE(25) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_13_voltage`]: {
                    value: buffer.readUInt16BE(27) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_14_voltage`]: {
                    value: buffer.readUInt16BE(29) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_15_voltage`]: {
                    value: buffer.readUInt16BE(31) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_16_voltage`]: {
                    value: buffer.readUInt16BE(33) / 1000.0,
                    unit: 'V',
                    role: 'value.voltage',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_temp_1`]: {
                    value: buffer.readUInt16BE(35) / 10.0 - 273.15,
                    unit: '°C',
                    role: 'value.temperature',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_temp_2`]: {
                    value: buffer.readUInt16BE(37) / 10.0 - 273.15,
                    unit: '°C',
                    role: 'value.temperature',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_temp_3`]: {
                    value: buffer.readUInt16BE(39) / 10.0 - 273.15,
                    unit: '°C',
                    role: 'value.temperature',
                    ctype: 'number',
                },
                [`${bmsFolder}.cell_temp_4`]: {
                    value: buffer.readUInt16BE(41) / 10.0 - 273.15,
                    unit: '°C',
                    role: 'value.temperature',
                    ctype: 'number',
                },
                [`${bmsFolder}.case_temp`]: {
                    value: buffer.readUInt16BE(51) / 10.0 - 273.15,
                    unit: '°C',
                    role: 'value.temperature',
                    ctype: 'number',
                },
                [`${bmsFolder}.power_temp`]: {
                    value: buffer.readUInt16BE(53) / 10.0 - 273.15,
                    unit: '°C',
                    role: 'value.temperature',
                    ctype: 'number',
                },
            };
        }

        for (const [key, { value, unit, role, ctype }] of Object.entries(updates)) {
            if (
                !this.lastUpdate[key] ||
                now - this.lastUpdate[key] >= this.updateInterval
            ) {
                this.lastUpdate[key] = now;
                await this.ensureObjectExists(key, {
                    type: 'state',
                    common: {
                        name: key,
                        type: ctype,
                        role,
                        unit,
                        read: true,
                        write: false,
                    },
                    native: {},
                });
                if (!this.isShuttingDown) {
                    this.setState(key, { val: value, ack: true });
                }
            }
        }
    }
}

if (require.main !== module) {
    module.exports = options => new SeplosV3Sniffer(options);
} else {
    new SeplosV3Sniffer();
}

const warema = require('warema-wms-venetian-blinds');
var mqtt = require('mqtt')

process.on('SIGINT', function () {
    process.exit(0);
});

const ignoredDevices = process.env.IGNORED_DEVICES ? process.env.IGNORED_DEVICES.split(',') : [];
const forceDevices = process.env.FORCE_DEVICES ? process.env.FORCE_DEVICES.split(',') : [];
const updateInterval = process.env.UPDATE_INTERVAL || 30000;
const debug = process.env.DEBUG || false;

const settingsPar = {
    wmsChannel: process.env.WMS_CHANNEL || 17,
    wmsKey: process.env.WMS_KEY || '00112233445566778899AABBCCDDEEFF',
    wmsPanid: process.env.WMS_PAN_ID || 'FFFF',
    wmsSerialPort: process.env.WMS_SERIAL_PORT || '/dev/ttyUSB0',
};

var registered_shades = [];
var shade_position = [];

function registerDevice(element) {
    console.log('Registering ' + element.snr)
    var topic = 'homeassistant/cover/' + element.snr + '/' + element.snr + '/config'
    var availability_topic = 'warema/' + element.snr + '/availability'

    var base_payload = {
        name: element.snr,
        availability: [
            {topic: 'warema/bridge/state'},
            {topic: availability_topic}
        ],
        unique_id: element.snr
    }

    var base_device = {
        identifiers: element.snr,
        manufacturer: "Warema",
        name: element.snr
    }

    var model
    var payload
    switch (parseInt(element.type)) {
        case 6:
            model = 'Weather station'
            payload = {
                ...base_payload,
                device: {
                    ...base_device,
                    model: model
                }
            }

            var illuminance_payload = {
                ...payload,
                state_topic: 'warema/' + element.snr + '/illuminance/state',
                device_class: 'illuminance',
                unique_id: element.snr + '_illuminance',
                unit_of_measurement: 'lm',
            }
            client.publish('homeassistant/sensor/' + element.snr + '/illuminance/config', JSON.stringify(illuminance_payload))

            var temperature_payload = {
                ...payload,
                state_topic: 'warema/' + element.snr + '/temperature/state',
                device_class: 'temperature',
                unique_id: element.snr + '_temperature',
                unit_of_measurement: 'C',
            }
            client.publish('homeassistant/sensor/' + element.snr + '/temperature/config', JSON.stringify(temperature_payload))

            var wind_payload = {
                ...payload,
                state_topic: 'warema/' + element.snr + '/wind/state',
                device_class: 'wind_speed',
                unique_id: element.snr + '_wind',
                unit_of_measurement: 'm/s',
            }
            client.publish('homeassistant/sensor/' + element.snr + '/wind/config', JSON.stringify(wind_payload))

            var rain_payload = {
                ...payload,
                state_topic: 'warema/' + element.snr + '/rain/state',
                device_class: 'moisture',
                unique_id: element.snr + '_rain'
            }
            client.publish('homeassistant/binary_sensor/' + element.snr + '/rain/config', JSON.stringify(rain_payload))

            client.publish(availability_topic, 'online', {retain: true})
            registered_shades += element.snr
            // No need to add to stick, updates are broadcasted
            return;
        case 9:
            // WMS WebControl Pro - while part of the network, we have no business to do with it.
            return;
        case 20:
            model = 'Plug receiver'
            payload = {
                ...base_payload,
                device: {
                    ...base_device,
                    model: model
                },
                position_open: 0,
                position_closed: 100,
                command_topic: 'warema/' + element.snr + '/set',
                position_topic: 'warema/' + element.snr + '/position',
                tilt_status_topic: 'warema/' + element.snr + '/tilt',
                set_position_topic: 'warema/' + element.snr + '/set_position',
                tilt_command_topic: 'warema/' + element.snr + '/set_tilt',
                tilt_closed_value: -100,
                tilt_opened_value: 100,
                tilt_min: -100,
                tilt_max: 100,
            }
            break;
        case 21:
            model = 'Actuator UP'
            payload = {
                ...base_payload,
                device: {
                    ...base_device,
                    model: model
                },
                position_open: 0,
                position_closed: 100,
                command_topic: 'warema/' + element.snr + '/set',
                position_topic: 'warema/' + element.snr + '/position',
                tilt_status_topic: 'warema/' + element.snr + '/tilt',
                set_position_topic: 'warema/' + element.snr + '/set_position',
                tilt_command_topic: 'warema/' + element.snr + '/set_tilt',
                tilt_closed_value: -100,
                tilt_opened_value: 100,
                tilt_min: -100,
                tilt_max: 100,
            }
            break;
        case 25:
            model = 'Vertical awning'
            payload = {
                ...base_payload,
                device: {
                    ...base_device,
                    model: model
                },
                position_open: 0,
                position_closed: 100,
                command_topic: 'warema/' + element.snr + '/set',
                position_topic: 'warema/' + element.snr + '/position',
                set_position_topic: 'warema/' + element.snr + '/set_position',
            }
            break;
        default:
            console.log('Unrecognized device type: ' + element.type)
            model = 'Unknown model ' + element.type
            return
    }

    if (ignoredDevices.includes(element.snr.toString())) {
        console.log('Ignoring and removing device ' + element.snr + ' (type ' + element.type + ')')
    } else {
        console.log('Adding device ' + element.snr + ' (type ' + element.type + ')')

        stickUsb.vnBlindAdd(parseInt(element.snr), element.snr.toString());

        registered_shades += element.snr
        client.publish(availability_topic, 'online', {retain: true})
        client.publish(topic, JSON.stringify(payload))
    }
}

function callback(err, msg) {
    if (err) {
        console.log('ERROR: ' + err);
    }
    if (msg) {
        switch (msg.topic) {
            case 'wms-vb-init-completion':
                console.log('Warema init completed')
                client.publish('warema/bridge/state', 'online', {retain: true})

                console.log('Scanning...')
                stickUsb.scanDevices({autoAssignBlinds: false});

                stickUsb.setPosUpdInterval(updateInterval);
                break;
            case 'wms-vb-scanned-devices':
                console.log('Scanned devices:\n' + JSON.stringify(msg.payload));
                if (forceDevices && forceDevices.length) {
                    forceDevices.forEach(deviceString => {
                        var tokens = deviceString.split(':');

                        registerDevice({snr: tokens[0], type: tokens[1] || 25})
                    })
                } else {
                    msg.payload.devices.forEach(element => registerDevice(element))
                }
                console.log(stickUsb.vnBlindsList())
                break;
            case 'wms-vb-rcv-weather-broadcast':
                if (debug) console.log('Weather broadcast:\n' + JSON.stringify(msg.payload))

                if (!registered_shades.includes(msg.payload.weather.snr)) {
                    registerDevice({snr: msg.payload.weather.snr, type: 6});
                }

                client.publish('warema/' + msg.payload.weather.snr + '/illuminance/state', msg.payload.weather.lumen.toString())
                client.publish('warema/' + msg.payload.weather.snr + '/temperature/state', msg.payload.weather.temp.toString())
                client.publish('warema/' + msg.payload.weather.snr + '/wind/state', msg.payload.weather.wind.toString())
                client.publish('warema/' + msg.payload.weather.snr + '/rain/state', msg.payload.weather.rain? 'ON' : 'OFF')

                break;
            case 'wms-vb-blind-position-update':
                if (debug) console.log('Position update: \n' + JSON.stringify(msg.payload))

                client.publish('warema/' + msg.payload.snr + '/position', msg.payload.position.toString())
                client.publish('warema/' + msg.payload.snr + '/tilt', msg.payload.angle.toString())
                shade_position[msg.payload.snr] = {
                    position: msg.payload.position,
                    angle: msg.payload.angle
                }
                break;
            default:
                console.log('UNKNOWN MESSAGE: ' + JSON.stringify(msg));
        }
    }
}

var client = mqtt.connect(
    process.env.MQTT_SERVER,
    {
        username: process.env.MQTT_USER,
        password: process.env.MQTT_PASSWORD,
        will: {
            topic: 'warema/bridge/state',
            payload: 'offline',
            retain: true
        }
    }
)

client.on('connect', function () {
    console.log('Connected to MQTT')

    client.subscribe([
        'warema/+/set',
        'warema/+/set_position',
        'warema/+/set_tilt',
        'homeassistant/status'
    ]);
})

client.on('error', function (error) {
    console.log('MQTT Error: ' + error.toString())
})

client.on('message', function (topic, message) {
    if (debug) console.log('Received message on topic ' + topic + ': ' + message)

    let scope, device, command;
    [scope, device, command] = topic.split('/');

    if (debug) console.log('Scope: ' + scope + ', device: ' + device + ', command: ' + command)

    if (scope === 'homeassistant' && command === 'status') {
        if (message === 'online') {
            registerDevices()
        }
        return;
    }

    //scope === 'warema'
    switch (command) {
        case 'set':
            switch (message) {
                case 'CLOSE':
                    stickUsb.vnBlindSetPosition(device, 100)
                    break;
                case 'OPEN':
                    stickUsb.vnBlindSetPosition(device, 0)
                    break;
                case 'STOP':
                    stickUsb.vnBlindStop(device)
                    break;
            }
            break;
        case 'set_position':
            stickUsb.vnBlindSetPosition(device, parseInt(message), parseInt(shade_position[device]['angle']))
            break;
        case 'set_tilt':
            stickUsb.vnBlindSetPosition(device, parseInt(shade_position[device]['position']), parseInt(message))
            break;
        default:
            console.log('Unrecognised command from HA')
    }
});

var stickUsb = new warema(settingsPar.wmsSerialPort,
    settingsPar.wmsChannel,
    settingsPar.wmsPanid,
    settingsPar.wmsKey,
    {},
    callback
);

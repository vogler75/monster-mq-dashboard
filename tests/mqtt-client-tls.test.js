import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMqttTlsInput, isMqttTlsUrl, mqttTlsSupportState } from '../src/js/mqtt-client-detail.js';

const queryFields = new Set([
    'brokerUrl', 'tlsCaCertPath', 'tlsClientCertPath', 'tlsClientKeyPath',
    'tlsClientKeyPasswordSet', 'tlsClientKeyFormat', 'tlsAlpnProtocols', 'tlsServerName'
]);
const inputFields = new Set([
    'brokerUrl', 'tlsCaCertPath', 'tlsClientCertPath', 'tlsClientKeyPath',
    'tlsClientKeyPassword', 'tlsClientKeyFormat', 'tlsAlpnProtocols', 'tlsServerName'
]);

test('MQTT TLS capability requires both complete query and input fields', () => {
    assert.equal(mqttTlsSupportState(queryFields, inputFields), 'supported');
    assert.equal(mqttTlsSupportState(new Set(['brokerUrl']), new Set(['brokerUrl'])), 'legacy');
    assert.equal(mqttTlsSupportState(new Set(), new Set()), 'unknown');
    assert.equal(mqttTlsSupportState(new Set(['brokerUrl']), inputFields), 'unknown');
    assert.equal(mqttTlsSupportState(queryFields, new Set(['brokerUrl', 'tlsClientCertPath'])), 'unknown');
});

test('MQTT TLS URLs include the edge broker tls scheme', () => {
    for (const url of ['ssl://host:8883', 'tls://host:8883', 'wss://host/mqtt', ' TLS://host:8883 ']) {
        assert.equal(isMqttTlsUrl(url), true, url);
    }
    for (const url of ['tcp://host:1883', 'ws://host/mqtt', '']) {
        assert.equal(isMqttTlsUrl(url), false, url);
    }
});

test('saving an edge tls bridge retains certificate options and an unchanged key password', () => {
    assert.deepEqual(buildMqttTlsInput({
        brokerUrl: 'tls://host:8883',
        tlsCaCertPath: ' /certs/ca.pem ',
        tlsClientCertPath: '/certs/client.pem',
        tlsClientKeyPath: '/certs/client.key',
        tlsClientKeyFormat: 'PEM',
        tlsAlpnProtocols: 'x-amzn-mqtt-ca, mqtt',
        tlsServerName: ' mqtt.example.com ',
        passwordSet: true
    }), {
        tlsCaCertPath: '/certs/ca.pem',
        tlsClientCertPath: '/certs/client.pem',
        tlsClientKeyPath: '/certs/client.key',
        tlsClientKeyPassword: null,
        tlsClientKeyFormat: 'PEM',
        tlsAlpnProtocols: ['x-amzn-mqtt-ca', 'mqtt'],
        tlsServerName: 'mqtt.example.com'
    });
});

test('switching to plain MQTT explicitly clears stored TLS options', () => {
    assert.deepEqual(buildMqttTlsInput({ brokerUrl: 'tcp://host:1883', passwordSet: true }), {
        tlsCaCertPath: '',
        tlsClientCertPath: '',
        tlsClientKeyPath: '',
        tlsClientKeyPassword: '',
        tlsClientKeyFormat: 'PEM',
        tlsAlpnProtocols: [],
        tlsServerName: ''
    });
});

test('a PKCS12 bundle clears an old PEM key path and can explicitly clear its password', () => {
    const input = buildMqttTlsInput({
        brokerUrl: 'ssl://host:8883',
        tlsClientCertPath: '/certs/client.p12',
        tlsClientKeyPath: '/certs/old-key.pem',
        tlsClientKeyFormat: 'PKCS12',
        passwordSet: true,
        clearPassword: true
    });
    assert.equal(input.tlsClientCertPath, '/certs/client.p12');
    assert.equal(input.tlsClientKeyPath, '');
    assert.equal(input.tlsClientKeyPassword, '');
});

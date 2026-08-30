/*
 * Mike Bluetooth capability.
 * Intentionally isolated from the Realtime voice/WebRTC path.
 * Uses Web Bluetooth where the browser supports it and exposes connection
 * state/events to the rest of Mike without taking over audio routing.
 */

const EVENT_NAME = 'mike:bluetooth';
let device = null;
let server = null;

const emit = (type, extra = {}) => {
  const detail = { type, supported: !!navigator.bluetooth, connected: !!device?.gatt?.connected, deviceName: device?.name || '', ...extra };
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
  window.MikeBluetooth?.onEvent?.(detail);
};

const onDisconnected = () => {
  server = null;
  emit('disconnected');
};

export const bluetoothSupported = () => typeof navigator !== 'undefined' && 'bluetooth' in navigator;

export async function connectBluetooth() {
  if (!bluetoothSupported()) {
    emit('unsupported');
    throw new Error('Bluetooth peripherals are not supported by this browser.');
  }
  if (device?.gatt?.connected) {
    emit('connected');
    return { device, server };
  }

  emit('connecting');
  device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
  device.addEventListener('gattserverdisconnected', onDisconnected);
  if (!device.gatt) throw new Error('This Bluetooth device does not expose a GATT connection.');
  server = await device.gatt.connect();
  emit('connected');
  return { device, server };
}

export async function disconnectBluetooth() {
  if (device?.gatt?.connected) device.gatt.disconnect();
  else emit('disconnected');
}

export function getBluetoothState() {
  return {
    supported: bluetoothSupported(),
    connected: !!device?.gatt?.connected,
    deviceName: device?.name || ''
  };
}

window.MikeBluetooth = {
  connect: connectBluetooth,
  disconnect: disconnectBluetooth,
  state: getBluetoothState,
  onEvent: null
};

const style = document.createElement('style');
style.textContent = `
  .mike-bt-control{position:fixed;right:16px;bottom:88px;z-index:1000;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:#101010;color:#fff;padding:9px 13px;font:600 12px/1 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.28);cursor:pointer}
  .mike-bt-control:hover{border-color:rgba(255,255,255,.32)}
  .mike-bt-control:disabled{opacity:.55;cursor:not-allowed}
`;
document.head.appendChild(style);

const button = document.createElement('button');
button.type = 'button';
button.className = 'mike-bt-control';
button.setAttribute('aria-label', 'Connect a Bluetooth peripheral to Mike');
button.textContent = 'Bluetooth';
document.body.appendChild(button);

const render = (detail) => {
  if (!detail.supported) button.textContent = 'Bluetooth unavailable';
  else if (detail.type === 'connecting') button.textContent = 'Connecting…';
  else if (detail.connected) button.textContent = `Bluetooth: ${detail.deviceName || 'Connected'}`;
  else button.textContent = 'Bluetooth';
  button.disabled = detail.type === 'connecting';
};

window.addEventListener(EVENT_NAME, (event) => render(event.detail));

button.addEventListener('click', async () => {
  try {
    if (device?.gatt?.connected) await disconnectBluetooth();
    else await connectBluetooth();
  } catch (error) {
    emit('error', { message: error?.message || 'Bluetooth connection failed.' });
    console.warn('[bluetooth]', error);
  }
});

render({ supported: bluetoothSupported(), connected: false, type: 'ready' });

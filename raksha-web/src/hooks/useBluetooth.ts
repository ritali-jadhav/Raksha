import { useState, useEffect, useRef, useCallback } from 'react';

const BLE_DEVICE_NAME = 'Raksha_Device';
const BLE_SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
const BLE_CHARACTERISTIC_UUID = 'abcd1234-ab12-cd34-ef56-1234567890ab';

export interface BLEState {
  connected: boolean;
  connecting: boolean;
  deviceName: string | null;
  error: string | null;
}

export interface BLESOSData {
  lat: number;
  lng: number;
}

/**
 * Hook for managing BLE connection to the Raksha safety device.
 * Listens for "SOS|lat,lng" messages and fires the onSOSTrigger callback.
 * Handles reconnection on disconnect automatically.
 */
export function useBluetooth(onSOSTrigger: (data: BLESOSData) => void) {
  const [state, setState] = useState<BLEState>({
    connected: false,
    connecting: false,
    deviceName: null,
    error: null,
  });

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const characteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onSOSTriggerRef = useRef(onSOSTrigger);

  // Keep callback ref fresh without re-subscribing BLE notifications
  useEffect(() => {
    onSOSTriggerRef.current = onSOSTrigger;
  }, [onSOSTrigger]);

  /**
   * Parse incoming BLE message: "SOS|latitude,longitude"
   */
  const parseMessage = useCallback((raw: string): BLESOSData | null => {
    try {
      const trimmed = raw.trim();
      if (!trimmed.startsWith('SOS|')) return null;

      const payload = trimmed.substring(4); // after "SOS|"
      const [latStr, lngStr] = payload.split(',');

      const lat = parseFloat(latStr);
      const lng = parseFloat(lngStr);

      if (isNaN(lat) || isNaN(lng)) {
        console.warn('[BLE] Invalid coordinates:', payload);
        return null;
      }

      return { lat, lng };
    } catch (err) {
      console.error('[BLE] Message parse error:', err);
      return null;
    }
  }, []);

  /**
   * Handle incoming BLE characteristic value change (notification)
   */
  const handleNotification = useCallback((event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const value = target.value;
    if (!value) return;

    // Decode the DataView to string
    const decoder = new TextDecoder('utf-8');
    const message = decoder.decode(value);
    console.log('[BLE] Received:', message);

    const sosData = parseMessage(message);
    if (sosData) {
      console.log('[BLE] SOS triggered from device:', sosData);
      onSOSTriggerRef.current(sosData);
    }
  }, [parseMessage]);

  /**
   * Attempt to reconnect to a previously paired device
   */
  const attemptReconnect = useCallback(async () => {
    const device = deviceRef.current;
    if (!device || !device.gatt) return;

    console.log('[BLE] Attempting reconnection...');
    setState(prev => ({ ...prev, connecting: true, error: null }));

    try {
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(BLE_SERVICE_UUID);
      const characteristic = await service.getCharacteristic(BLE_CHARACTERISTIC_UUID);

      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', handleNotification);
      characteristicRef.current = characteristic;

      setState({
        connected: true,
        connecting: false,
        deviceName: device.name || BLE_DEVICE_NAME,
        error: null,
      });

      console.log('[BLE] Reconnected successfully');
    } catch (err: any) {
      console.error('[BLE] Reconnection failed:', err);
      setState(prev => ({
        ...prev,
        connected: false,
        connecting: false,
        error: 'Reconnection failed — retrying...',
      }));

      // Retry after 5 seconds
      reconnectTimerRef.current = setTimeout(attemptReconnect, 5000);
    }
  }, [handleNotification]);

  /**
   * Handle device disconnection
   */
  const handleDisconnect = useCallback(() => {
    console.log('[BLE] Device disconnected');
    setState(prev => ({
      ...prev,
      connected: false,
      error: 'Device disconnected — reconnecting...',
    }));

    // Auto-reconnect after 2 seconds
    reconnectTimerRef.current = setTimeout(attemptReconnect, 2000);
  }, [attemptReconnect]);

  /**
   * Connect to the BLE device (user-initiated — requires gesture)
   */
  const connect = useCallback(async () => {
    if (!('bluetooth' in navigator)) {
      setState(prev => ({ ...prev, error: 'Bluetooth not supported on this device' }));
      return;
    }

    setState({ connected: false, connecting: true, deviceName: null, error: null });

    try {
      // Request device (requires user gesture)
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: BLE_DEVICE_NAME }],
        optionalServices: [BLE_SERVICE_UUID],
      });

      deviceRef.current = device;

      // Listen for disconnections
      device.addEventListener('gattserverdisconnected', handleDisconnect);

      // Connect to GATT server
      if (!device.gatt) {
        throw new Error('GATT not available on this device');
      }
      const server = await device.gatt.connect();
      console.log('[BLE] Connected to GATT server');

      // Access service
      const service = await server.getPrimaryService(BLE_SERVICE_UUID);
      console.log('[BLE] Service found');

      // Access characteristic
      const characteristic = await service.getCharacteristic(BLE_CHARACTERISTIC_UUID);
      console.log('[BLE] Characteristic found');

      // Enable notifications
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', handleNotification);
      characteristicRef.current = characteristic;

      console.log('[BLE] Notifications enabled — listening for SOS');

      setState({
        connected: true,
        connecting: false,
        deviceName: device.name || BLE_DEVICE_NAME,
        error: null,
      });
    } catch (err: any) {
      console.error('[BLE] Connection error:', err);

      // User cancelled the picker
      if (err.name === 'NotFoundError' || err.message?.includes('cancelled')) {
        setState({ connected: false, connecting: false, deviceName: null, error: null });
        return;
      }

      setState({
        connected: false,
        connecting: false,
        deviceName: null,
        error: err.message || 'Failed to connect to safety device',
      });
    }
  }, [handleDisconnect, handleNotification]);

  /**
   * Disconnect from the BLE device
   */
  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }

    if (characteristicRef.current) {
      try {
        characteristicRef.current.removeEventListener('characteristicvaluechanged', handleNotification);
        characteristicRef.current.stopNotifications().catch(() => {});
      } catch {}
      characteristicRef.current = null;
    }

    if (deviceRef.current) {
      deviceRef.current.removeEventListener('gattserverdisconnected', handleDisconnect);
      if (deviceRef.current.gatt?.connected) {
        deviceRef.current.gatt.disconnect();
      }
      deviceRef.current = null;
    }

    setState({ connected: false, connecting: false, deviceName: null, error: null });
    console.log('[BLE] Disconnected');
  }, [handleDisconnect, handleNotification]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  return { ...state, connect, disconnect };
}

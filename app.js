// Constants
const LOG_KEY = 'cell_data_logs';
const CHECK_INTERVAL = 10000; // 10 seconds for connectivity
const GPS_INTERVAL = 60000;   // 60 seconds for GPS
const STREAM_URL = 'https://stream.live.vc.bbc.com/bbc_world_service';

// Elements
const startBtn = document.getElementById('startBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const logEntries = document.getElementById('logEntries');
const videoElem = document.getElementById('keepAwakeVideo');
const audioElem = document.getElementById('streamAudio');

const statusNet = document.getElementById('statusNet');
const statusStream = document.getElementById('statusStream');
const statusGPS = document.getElementById('statusGPS');

// State
let isTracking = false;
let checkTimer = null;
let gpsTimer = null;
let lastGps = { lat: null, lon: null };

// Silent video base64 (1x1 black frame, 1s)
const SILENT_VIDEO_B64 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21hdmMxbXA0MgAAAAhZy19vAAADcm1vb3YAAABsbXZoZAAAAADbe6Z423umeNoAAAfQAAACmQABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACNnRyYWsAAABcdGtoZAAAAADbe6Z423umeNoAAAABAAAAAAACmQAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAACBlZHRzAAAAHGVsc3QAAAAAAAAAAQAAApkAAAAAAAABAAAAAAG6bWRpYQAAACBtZGhkAAAAANt7pnjbe6Z40AAAC7gAAAIdAFV4AAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABS21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAA51cmwgAAAAAQAAASJzdGJsAAAAr3N0c2QAAAAAAAAAAQAAAJ9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAIAAgABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAALWF2Y0MBQsAr/+EAF2eEAWLAsv4CAAAAAwAAAAEAAAMDAi8I6Y2YAAAACHByb2YAAAAAAAAAABhzdHRzAAAAAAAAAAEAAAABAAACmQAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzeiAAAAAAAAAAAAAAAQAAABRzdGNvAAAAAAAAAAEAAAA4AAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpciAAAAAAAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNTguMjkuMTAw';

// Initialize
function init() {
    loadLogsFromStorage();
    updateStatus('net', navigator.onLine ? 'Online' : 'Offline', navigator.onLine ? 'ok' : 'error');
    
    window.addEventListener('online', () => updateStatus('net', 'Online', 'ok'));
    window.addEventListener('offline', () => updateStatus('net', 'Offline', 'error'));

    startBtn.addEventListener('click', toggleTracking);
    exportBtn.addEventListener('click', exportLogs);
    clearBtn.addEventListener('click', clearLogs);

    // Set video source
    videoElem.src = SILENT_VIDEO_B64;
    audioElem.src = STREAM_URL;
}

function toggleTracking() {
    if (isTracking) {
        stopTracking();
    } else {
        startTracking();
    }
}

async function startTracking() {
    isTracking = true;
    startBtn.innerText = 'Stop Tracking';
    startBtn.classList.add('active');

    logToUI('Requesting GPS and Media...');

    try {
        // 1. Request GPS immediately to trigger permission dialog
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const { latitude, longitude } = pos.coords;
                    lastGps = { lat: latitude.toFixed(6), lon: longitude.toFixed(6) };
                    updateStatus('gps', `${lastGps.lat}, ${lastGps.lon}`, 'ok');
                    logEntry('System', 'GPS Permission Granted');
                },
                (err) => {
                    updateStatus('gps', 'Denied/Error', 'error');
                    logToUI('GPS Error: ' + err.message);
                },
                { enableHighAccuracy: true, timeout: 5000 }
            );
        }

        // 2. Prime media elements (iOS Safari requirement)
        videoElem.play().catch(() => {});
        videoElem.pause();
        audioElem.play().catch(() => {});
        audioElem.pause();

        // 3. Start actual playback
        // We'll use a small timeout to let the UI thread breathe
        setTimeout(async () => {
            try {
                await videoElem.play();
                await audioElem.play();
                
                logToUI('Tracking active & Keep-awake on');
                logEntry('System', 'Tracking Session Started');

                // Start Intervals
                checkTimer = setInterval(checkConnectivity, CHECK_INTERVAL);
                gpsTimer = setInterval(logGPS, GPS_INTERVAL);
            } catch (mediaErr) {
                console.error('Media Start Error:', mediaErr);
                logToUI('Media Error: ' + mediaErr.message);
                // Don't stop tracking just for audio failure, the script might still run
            }
        }, 100);
        
    } catch (err) {
        console.error('Initialization failed:', err);
        logToUI('Init Error: ' + err.message);
        stopTracking();
    }
}

function stopTracking() {
    isTracking = false;
    startBtn.innerText = 'Start Tracking';
    startBtn.classList.remove('active');

    videoElem.pause();
    audioElem.pause();

    clearInterval(checkTimer);
    clearInterval(gpsTimer);

    logToUI('Tracking stopped');
    logEntry('System', 'Tracking Session Stopped');
}

function checkConnectivity() {
    const isOnline = navigator.onLine;
    const streamState = audioElem.readyState; // 0=HAVE_NOTHING, 4=HAVE_ENOUGH_DATA
    const streamStalled = audioElem.paused || streamState < 3;

    updateStatus('net', isOnline ? 'Online' : 'Offline', isOnline ? 'ok' : 'error');
    updateStatus('stream', streamStalled ? 'Stalled' : 'Playing', streamStalled ? 'error' : 'ok');

    if (!isOnline || streamStalled) {
        logEntry('Alert', `Drop: Net=${isOnline}, Stream=${streamState}`);
        
        // Attempt recovery
        if (isOnline && streamStalled) {
            audioElem.load();
            audioElem.play().catch(() => {});
        }
    }
}

function logGPS() {
    if (!navigator.geolocation) {
        updateStatus('gps', 'Not Supported', 'error');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude, longitude, accuracy } = pos.coords;
            lastGps = { lat: latitude.toFixed(6), lon: longitude.toFixed(6) };
            updateStatus('gps', `${lastGps.lat}, ${lastGps.lon}`, 'ok');
            
            // Log with connectivity info
            const status = navigator.onLine ? 'Online' : 'Offline';
            logEntry('Data', `GPS: ${lastGps.lat},${lastGps.lon} | Net: ${status}`);
        },
        (err) => {
            console.error('GPS Error:', err);
            updateStatus('gps', 'Error: ' + err.code, 'error');
            logEntry('Error', 'GPS Fetch Failed: ' + err.message);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function logEntry(type, message) {
    const timestamp = new Date().toISOString();
    const entry = {
        timestamp,
        type,
        message,
        lat: lastGps.lat,
        lon: lastGps.lon,
        online: navigator.onLine
    };

    saveLogToStorage(entry);
    logToUI(`[${new Date().toLocaleTimeString()}] ${type}: ${message}`);
}

function saveLogToStorage(entry) {
    let logs = JSON.parse(localStorage.getItem(LOG_KEY)) || [];
    logs.push(entry);
    localStorage.setItem(LOG_KEY, JSON.stringify(logs));
}

function loadLogsFromStorage() {
    let logs = JSON.parse(localStorage.getItem(LOG_KEY)) || [];
    logs.slice(-20).forEach(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        logToUI(`[${time}] ${entry.type}: ${entry.message}`);
    });
}

function logToUI(message) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerText = message;
    logEntries.prepend(div);
}

function updateStatus(id, text, className) {
    const elem = document.getElementById('status' + id.charAt(0).toUpperCase() + id.slice(1));
    if (elem) {
        elem.innerText = text;
        elem.className = 'status-value ' + className;
    }
}

function exportLogs() {
    let logs = JSON.parse(localStorage.getItem(LOG_KEY)) || [];
    if (logs.length === 0) {
        alert('No logs to export.');
        return;
    }

    const headers = ['Timestamp', 'Type', 'Message', 'Latitude', 'Longitude', 'Online'];
    const csvRows = [headers.join(',')];

    for (const log of logs) {
        const row = [
            log.timestamp,
            `"${log.type}"`,
            `"${log.message.replace(/"/g, '""')}"`,
            log.lat || '',
            log.lon || '',
            log.online
        ];
        csvRows.push(row.join(','));
    }

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `cell_logs_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function clearLogs() {
    if (confirm('Are you sure you want to clear all logs?')) {
        localStorage.removeItem(LOG_KEY);
        logEntries.innerHTML = '';
        logToUI('Logs cleared');
    }
}

document.addEventListener('DOMContentLoaded', init);

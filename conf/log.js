// Modul logger untuk aplikasi
const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, '../logs');
        this.ensureLogDirectory();
    }

    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    getTimestamp() {
        return new Date().toISOString();
    }

    formatMessage(level, message, data = null) {
        const timestamp = this.getTimestamp();
        let logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        
        if (data) {
            if (typeof data === 'object') {
                logMessage += `\n${JSON.stringify(data, null, 2)}`;
            } else {
                logMessage += ` - ${data}`;
            }
        }
        
        return logMessage;
    }

    writeToFile(level, message, data = null) {
        const logMessage = this.formatMessage(level, message, data);
        const logFile = path.join(this.logDir, `${level}.log`);
        
        try {
            fs.appendFileSync(logFile, logMessage + '\n');
        } catch (error) {
            console.error('Error writing to log file:', error);
        }
    }

    info(message, data = null) {
        const logMessage = this.formatMessage('info', message, data);
        console.log(logMessage);
        this.writeToFile('info', message, data);
    }

    warn(message, data = null) {
        const logMessage = this.formatMessage('warn', message, data);
        console.warn(logMessage);
        this.writeToFile('warn', message, data);
    }

    error(message, data = null) {
        const logMessage = this.formatMessage('error', message, data);
        console.error(logMessage);
        this.writeToFile('error', message, data);
    }

    debug(message, data = null) {
        if (process.env.NODE_ENV === 'development') {
            const logMessage = this.formatMessage('debug', message, data);
            console.log(logMessage);
            this.writeToFile('debug', message, data);
        }
    }
}

// Create singleton instance
const logger = new Logger();

module.exports = logger;

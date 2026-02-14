type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

class Logger {
  constructor(private context: string) {}

  private log(level: LogLevel, message: string, data?: any) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0]; // HH:mm:ss
    const color = this.getColor(level);
    const reset = "\x1b[0m";
    
    // Format: [14:30:05] [DEBUG] [Hub/Registry] Your message here
    const prefix = `[${timestamp}] ${color}[${level}]${reset} [${this.context}]`;
    
    if (data) {
      console.log(`${prefix} ${message}`, data);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  private getColor(level: LogLevel): string {
    switch (level) {
      case 'DEBUG': return "\x1b[36m"; // Cyan
      case 'INFO':  return "\x1b[32m"; // Green
      case 'WARN':  return "\x1b[33m"; // Yellow
      case 'ERROR': return "\x1b[31m"; // Red
      default:      return "";
    }
  }

  debug(msg: string, data?: any) { this.log('DEBUG', msg, data); }
  info(msg: string, data?: any)  { this.log('INFO', msg, data); }
  warn(msg: string, data?: any)  { this.log('WARN', msg, data); }
  error(msg: string, data?: any) { this.log('ERROR', msg, data); }
}

// Helper to create loggers with context
export const createLogger = (context: string) => new Logger(context);
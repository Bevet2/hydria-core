type LogLevel = "INFO" | "WARN" | "ERROR";

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...(meta ? { meta } : {})
  };

  const line = JSON.stringify(payload);
  if (level === "ERROR") {
    console.error(line);
    return;
  }

  if (level === "WARN") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    emit("INFO", message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>) {
    emit("WARN", message, meta);
  },
  error(message: string, meta?: Record<string, unknown>) {
    emit("ERROR", message, meta);
  }
};

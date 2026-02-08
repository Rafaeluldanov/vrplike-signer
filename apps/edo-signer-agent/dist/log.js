"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFileLogger = createFileLogger;
exports.hookConsoleToLogger = hookConsoleToLogger;
exports.hookConsoleToTeeLogger = hookConsoleToTeeLogger;
const fs_1 = require("fs");
const path = __importStar(require("path"));
function toNonEmptyString(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function safeMkdir(dir) {
    try {
        if ((0, fs_1.existsSync)(dir))
            return;
        (0, fs_1.mkdirSync)(dir, { recursive: true });
    }
    catch (_a) {
    }
}
function isoNow() {
    return new Date().toISOString();
}
function safeJson(meta) {
    if (!meta)
        return '';
    try {
        return ' ' + JSON.stringify(meta);
    }
    catch (_a) {
        return '';
    }
}
function safeUnlink(p) {
    try {
        (0, fs_1.unlinkSync)(p);
    }
    catch (_a) {
    }
}
function safeRename(from, to) {
    try {
        (0, fs_1.renameSync)(from, to);
    }
    catch (_a) {
    }
}
function rotateLogsIfNeeded(args) {
    const maxBytes = Math.max(256 * 1024, Number(args.maxBytes || 0));
    const maxFiles = Math.max(1, Math.min(20, Number(args.maxFiles || 0)));
    try {
        if (!(0, fs_1.existsSync)(args.logPath))
            return;
        const st = (0, fs_1.statSync)(args.logPath);
        if (!st || !Number.isFinite(st.size) || st.size <= maxBytes)
            return;
    }
    catch (_a) {
        return;
    }
    for (let i = maxFiles; i >= 1; i--) {
        const src = `${args.logPath}.${i}`;
        const dst = `${args.logPath}.${i + 1}`;
        if (i === maxFiles) {
            safeUnlink(src);
            continue;
        }
        if ((0, fs_1.existsSync)(src))
            safeRename(src, dst);
    }
    safeRename(args.logPath, `${args.logPath}.1`);
}
function createFileLogger(args) {
    var _a;
    const logsDir = args.logsDir;
    safeMkdir(logsDir);
    const logPath = path.join(logsDir, ((_a = toNonEmptyString(args.filename)) !== null && _a !== void 0 ? _a : 'signer.log').trim());
    const maxBytes = Number.isFinite(args.maxBytes) ? Number(args.maxBytes) : 10 * 1024 * 1024;
    const maxFiles = Number.isFinite(args.maxFiles) ? Number(args.maxFiles) : 5;
    const rotationCheckEveryWrites = Number.isFinite(args.rotationCheckEveryWrites) ? Number(args.rotationCheckEveryWrites) : 128;
    rotateLogsIfNeeded({ logPath, maxBytes, maxFiles });
    let stream = (0, fs_1.createWriteStream)(logPath, { flags: 'a' });
    let writesSinceRotationCheck = 0;
    let rotating = false;
    const buffer = [];
    const checkSizeExceeds = () => {
        try {
            if (!(0, fs_1.existsSync)(logPath))
                return false;
            const st = (0, fs_1.statSync)(logPath);
            return Boolean(st && Number.isFinite(st.size) && st.size > maxBytes);
        }
        catch (_a) {
            return false;
        }
    };
    const flushBuffer = () => {
        if (!buffer.length)
            return;
        const pending = buffer.splice(0, buffer.length);
        try {
            for (const line of pending)
                stream.write(line);
        }
        catch (_a) {
        }
    };
    const rotateNow = () => {
        if (rotating)
            return;
        rotating = true;
        try {
            stream.end(() => {
                try {
                    rotateLogsIfNeeded({ logPath, maxBytes, maxFiles });
                }
                catch (_a) {
                }
                try {
                    stream = (0, fs_1.createWriteStream)(logPath, { flags: 'a' });
                }
                catch (_b) {
                }
                rotating = false;
                flushBuffer();
            });
        }
        catch (_a) {
            rotating = false;
        }
    };
    const write = (level, msg, meta) => {
        try {
            writesSinceRotationCheck++;
            if (writesSinceRotationCheck >= rotationCheckEveryWrites) {
                writesSinceRotationCheck = 0;
                if (checkSizeExceeds())
                    rotateNow();
            }
            const line = `[${isoNow()}] [${level}] ${String(msg !== null && msg !== void 0 ? msg : '')}${safeJson(meta)}\n`;
            if (rotating) {
                buffer.push(line);
                return;
            }
            stream.write(line);
        }
        catch (_a) {
        }
    };
    return {
        logsDir,
        logPath,
        info: (msg, meta) => write('INFO', msg, meta),
        warn: (msg, meta) => write('WARN', msg, meta),
        error: (msg, meta) => write('ERROR', msg, meta),
        close: () => {
            try {
                rotating = true;
                buffer.splice(0, buffer.length);
                stream.end();
            }
            catch (_a) {
            }
        },
    };
}
function hookConsoleToLogger(logger) {
    const map = (args) => args
        .map((a) => {
        var _a;
        if (typeof a === 'string')
            return a;
        if (a instanceof Error)
            return `${a.name}: ${a.message}\n${(_a = a.stack) !== null && _a !== void 0 ? _a : ''}`.trim();
        try {
            return JSON.stringify(a);
        }
        catch (_b) {
            return String(a);
        }
    })
        .join(' ');
    console.log = (...a) => logger.info(map(a));
    console.warn = (...a) => logger.warn(map(a));
    console.error = (...a) => logger.error(map(a));
}
function hookConsoleToTeeLogger(logger) {
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);
    const map = (args) => args
        .map((a) => {
        var _a;
        if (typeof a === 'string')
            return a;
        if (a instanceof Error)
            return `${a.name}: ${a.message}\n${(_a = a.stack) !== null && _a !== void 0 ? _a : ''}`.trim();
        try {
            return JSON.stringify(a);
        }
        catch (_b) {
            return String(a);
        }
    })
        .join(' ');
    console.log = (...a) => {
        try {
            origLog(...a);
        }
        finally {
            logger.info(map(a));
        }
    };
    console.warn = (...a) => {
        try {
            origWarn(...a);
        }
        finally {
            logger.warn(map(a));
        }
    };
    console.error = (...a) => {
        try {
            origError(...a);
        }
        finally {
            logger.error(map(a));
        }
    };
}
//# sourceMappingURL=log.js.map
/** Resources owned by one mounted page module. Shared shell resources stay global. */
export class PageLifecycle {
    constructor(host = window, dom = document) {
        this.host = host;
        this.dom = dom;
        this.disposed = false;
        this.cleanups = [];
        this.readyCallbacks = [];
        this.bindings = new Map();
        this.assigned = new Map();
        this.intervals = new Set();
        this.timeouts = new Set();
        this.frames = new Set();
        this.elements = new Set();
        this.ui = new Proxy(host.ui || {}, {
            get: (ui, key) => typeof ui[key] === 'function' ? (...args) => {
                if (this.disposed) return key === 'confirm' || key === 'confirmDelete' ? Promise.resolve(false) : undefined;
                return ui[key](...args);
            } : ui[key]
        });
        this.setInterval = (fn, delay, ...args) => this.timer(true, fn, delay, args);
        this.setTimeout = (fn, delay, ...args) => this.timer(false, fn, delay, args);
        this.clearInterval = id => { host.clearInterval(id); this.intervals.delete(id); this.timeouts.delete(id); };
        this.clearTimeout = id => { host.clearTimeout(id); this.timeouts.delete(id); this.intervals.delete(id); };
        this.requestAnimationFrame = fn => {
            if (this.disposed) return 0;
            const id = host.requestAnimationFrame(time => {
                this.frames.delete(id);
                if (!this.disposed) fn(time);
            });
            this.frames.add(id);
            return id;
        };
        this.cancelAnimationFrame = id => { host.cancelAnimationFrame(id); this.frames.delete(id); };
        this.document = this.target(dom, true);
        this.window = this.target(host, false);
        for (const name of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'WebSocket', 'EventSource']) {
            const Constructor = host[name];
            if (!Constructor) continue;
            const scope = this;
            this[name] = class extends Constructor {
                constructor(...args) {
                    super(...args);
                    scope.addCleanup(() => typeof this.disconnect === 'function' ? this.disconnect() : this.close());
                }
            };
        }
    }

    target(target, isDocument) {
        const scope = this;
        return new Proxy(target, {
            get(object, key) {
                if (!isDocument && key === 'ui') return scope.ui;
                if (isDocument && scope.disposed && !scope.cleaning) {
                    if (['getElementById', 'querySelector'].includes(key)) return () => null;
                    if (['querySelectorAll', 'getElementsByClassName', 'getElementsByTagName'].includes(key)) return () => [];
                }
                if (key === 'addEventListener') return (type, callback, options) => {
                    if (isDocument && type === 'DOMContentLoaded') {
                        scope.readyCallbacks.push(callback);
                        return;
                    }
                    if (scope.disposed) return;
                    object.addEventListener(type, callback, options);
                    scope.addCleanup(() => object.removeEventListener(type, callback, options));
                };
                if (!isDocument && key === 'registerPageCleanup') return fn => scope.addCleanup(fn);
                if (!isDocument && ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key)) return scope[key];
                if (isDocument && key === 'createElement') return (...args) => {
                    const element = object.createElement(...args);
                    scope.elements.add(element);
                    return element;
                };
                const value = Reflect.get(object, key, object);
                // Constructors keep their prototype; native object methods need their receiver.
                return typeof value === 'function' && !value.prototype ? value.bind(object) : value;
            },
            set(object, key, value) {
                if (scope.disposed) return true;
                if (isDocument) {
                    const previous = object[key];
                    object[key] = value;
                    scope.addCleanup(() => { if (object[key] === value) object[key] = previous; });
                } else {
                    scope.remember(key);
                    scope.assigned.set(key, value);
                    object[key] = value;
                }
                return true;
            }
        });
    }

    /** Own DOM inserted as HTML rather than through createElement(). */
    own(element) {
        if (element) {
            if (this.disposed) element.remove();
            else this.elements.add(element);
        }
        return element;
    }

    remember(name) {
        if (!this.bindings.has(name)) this.bindings.set(name, Object.getOwnPropertyDescriptor(this.host, name));
    }

    /** Explicit legacy inline-handler bridge, restored when the module is disposed. */
    expose(handlers) {
        for (const name of Object.keys(handlers)) {
            this.remember(name);
            const descriptor = Object.getOwnPropertyDescriptor(handlers, name);
            Object.defineProperty(this.host, name, {
                configurable: true,
                get: () => this.assigned.has(name) ? this.assigned.get(name) : descriptor.get ? descriptor.get() : descriptor.value,
                set: value => this.assigned.set(name, value)
            });
        }
    }

    timer(interval, fn, delay, args) {
        if (this.disposed) return 0;
        const timers = interval ? this.intervals : this.timeouts;
        const schedule = interval ? this.host.setInterval.bind(this.host) : this.host.setTimeout.bind(this.host);
        const id = schedule(() => {
            if (!interval) timers.delete(id);
            if (!this.disposed) fn(...args);
        }, delay);
        timers.add(id);
        return id;
    }

    addCleanup(fn) {
        if (this.disposed) fn();
        else this.cleanups.push(fn);
    }

    ready() {
        const callbacks = this.readyCallbacks.splice(0);
        for (const callback of callbacks) {
            try {
                const result = callback.call(this.dom);
                if (result?.catch) result.catch(error => {
                    if (!this.disposed) (this.host.ui?.error || console.error)((error && error.message) || error);
                });
            } catch (error) {
                if (!this.disposed) (this.host.ui?.error || console.error)((error && error.message) || error);
            }
        }
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.cleaning = true;
        for (const fn of this.cleanups.slice().reverse()) {
            try { fn(); } catch (error) { console.warn('Page cleanup failed:', error); }
        }
        for (const id of this.intervals) this.host.clearInterval(id);
        for (const id of this.timeouts) this.host.clearTimeout(id);
        for (const id of this.frames) this.host.cancelAnimationFrame(id);
        for (const element of this.elements) if (element.isConnected) element.remove();
        for (const [name, descriptor] of [...this.bindings].reverse()) {
            if (descriptor) Object.defineProperty(this.host, name, descriptor);
            else delete this.host[name];
        }
        this.cleaning = false;
        this.cleanups.length = 0;
        this.intervals.clear();
        this.timeouts.clear();
        this.frames.clear();
        this.elements.clear();
        this.bindings.clear();
        this.assigned.clear();
    }
}

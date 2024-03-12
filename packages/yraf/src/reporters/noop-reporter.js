import BaseReporter from "./base-reporter.js";
/* eslint no-unused-vars: 0 */

export default class NoopReporter extends BaseReporter {
  lang(key, ...args) {
    return super.lang(key, ...args);
  }
  verbose(msg) {}
  verboseInspect(val) {}
  initPeakMemoryCounter() {}
  checkPeakMemory() {}
  close() {}
  getTotalTime() {
    return 0;
  }
  list(key, items, hints) {}
  tree(key, obj) {}
  step(current, total, message, emoji) {}
  error(message) {}
  info(message) {}
  warn(message) {}
  success(message) {}
  log(message) {}
  command(command) {}
  inspect(value) {}
  header(command, pkg) {}
  footer(showPeakMemory) {}
  table(head, body) {}

  activity() {
    return {
      tick(name) {},
      end() {},
    };
  }

  activitySet(total, workers) {
    return {
      spinners: Array(workers).fill({
        clear() {},
        setPrefix() {},
        tick() {},
        end() {},
      }),
      end() {},
    };
  }

  question(question, options = {}) {
    return Promise.reject(new Error("Not implemented"));
  }

  async questionAffirm(question) {
    await this.question(question);
    return false;
  }

  select(header, question, options) {
    return Promise.reject(new Error("Not implemented"));
  }

  progress(total) {
    return function () {};
  }

  disableProgress() {
    this.noProgress = true;
  }

  prompt(message, choices, options = {}) {
    return Promise.reject(new Error("Not implemented"));
  }
}

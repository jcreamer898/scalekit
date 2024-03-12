import NoopReporter from "./noop-reporter.js";
/* eslint no-unused-vars: 0 */

import { reportProgress } from "./report-progress.js";

/**
 * Reporter which shows progress of an activity
 */
export default class ProgressReporter extends NoopReporter {
  activity(name, total) {
    return {
      name,
      total,
      completed: 0,
      setName(_name) {
        this.name = _name;
      },
      setTotal(_total) {
        this.total = _total;
      },
      addTotal(_total) {
        if (!this.total) {
          this.total = 0;
        }

        this.total += _total;
      },
      tick(name) {
        reportProgress(this.name, ++this.completed, this.total);
      },
      end() {
        reportProgress(this.name, this.total, this.total);
        process.stdout.write("\n");
      },
    };
  }
}

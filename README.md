# Grade Review

A two-part tool to review Compass course grades across seminars before you approve them.

1. **Collector.** A bookmarklet that runs on the Compass Director Dashboard in your own logged-in browser. It opens each student's Course Evaluation Report, reads it, closes it, and saves the result in your browser. It can work through many seminars in one run. You then download one file.
2. **Review page.** `grade-review.html`, one offline file. Open it in Edge or Chrome, load the file from step 1, and review.

Nothing goes to a server. The collector only reads pages you can already see. The review page has a security policy that blocks all network requests, so it cannot send data anywhere. The repo holds no student data; `.gitignore` blocks the export file names.

## Use

1. Download `grade-review.html` and open it (double-click).
2. Drag the **Collect grades** button to your bookmarks bar. If your browser blocks bookmarklets, use **copy the collector code**, then paste it into the browser console (F12) on the Compass page.
3. In Compass, open the Director Dashboard page where you pick a seminar. Click **Collect grades**, then **Collect many seminars**. The panel lists the seminar links or drop-down lists it found on the page. Tick the seminars and click **Start**. A work window opens over the page and reads every report in each seminar. Leave the tab open until the panel says Done. If a report does not open, or opens without its header, the collector closes it and tries once more. (If Compass refuses to load inside the page, the collector uses a pop-up window instead. Allow pop-ups for Compass if the browser asks.)
   - To read only the seminar on screen, open its student list and click **Collect this page**.
4. In the collector panel, click **Download for review**, then **Clear saved data**.
5. Load the file into `grade-review.html`.

## What the review page shows

| Tab | Content |
|---|---|
| Seminars | Per seminar: grade distribution, mean, difference from the rest of the course, share of A and A-, mean element rating, grades compared with ratings, share of individual comments, flag count, review status. |
| Rating patterns | Each combination of element ratings against the grades given for it. A row with more than one grade means faculty graded the same ratings differently. |
| Flags | Items to check, ranked High, Check, and Note. Add any flag to a seminar's query list. |
| Students | Every record, with filters. Click a row for the full report and the student's other courses. |
| Review log | Status and notes per seminar. Copy or download the query list (hyphen and tab format) or the whole log as CSV. |

### Checks

| Check | Level | Rule |
|---|---|---|
| Comment states a different grade | High | The overall comment says "final grade of (X)" and X is not the recorded grade. |
| Comment names a classmate | High | The overall comment names another student in the seminar and not this student. Likely copy and paste. |
| Comment matches another rating | High | An element comment is the standard text that other faculty used for a different rating. |
| Same ratings, different grade | Check | Most students in the course with these element ratings got a different grade. High if two or more steps apart. |
| Higher ratings, lower grade | Check | In the same seminar, a student rated at least as high on every element (and higher on one) got a lower grade than a classmate. |
| Seminar grades out of line | Check | Seminar mean differs from all other seminars by the threshold (default 0.15 grade points). |
| Grades out of line with ratings | Check | For the same element ratings, the seminar gives grades higher or lower than other seminars (default 0.15 points). Separates a strong seminar from lenient grading. |
| Low performance | Check | Grade at or below B- (settable) or any element below standards. High if in more than one course. |
| Data problems | High to Note | Missing grade or rating, dashboard and report disagree, no faculty name, no signature. |

PASS or FAIL results (for example International Fellows) count as pass/fail. They are left out of grade means and do not raise flags.

The thresholds are under **Flags > Thresholds**.

## If the collector fails

Compass may change its page layout. Click **Structure file** in the collector panel on the page that fails (the seminar picker, or a student list with a report open). It saves the page layout with every name, grade, and comment removed. Use it to adjust `src/collector.js`.

## Develop

```
npm run build   # writes grade-review.html from src/
npm test        # unit tests for the analysis
node test/e2e.mjs   # runs the collector on a mock Compass page, then the review page (needs Playwright)
```

| File | Purpose |
|---|---|
| `src/collector.js` | Bookmarklet code that runs on Compass. |
| `src/analysis.js` | All checks and statistics. No DOM. |
| `src/app.js`, `src/styles.css`, `src/template.html` | Review page. |
| `src/sample.js` | Made-up sample data for the "Try sample data" button and tests. |
| `test/mock-compass.html` | Made-up copy of the Director Dashboard student list and report for tests. |
| `test/mock-menu.html` | Made-up seminar picker (links, clickable rows, drop-down form) for tests. |

# IRON - The Ultimate Habit Optimization Ecosystem

#### Video Demo: <URL HERE>

#### Description:
**IRON** is a command-line/software tool engineered to optimize daily habits and routines through data-driven tracking. Unlike traditional habit tracking apps that simply monitor simple "yes/no" completions, IRON treats habit building as a system-optimization problem. It allows users to track behavioral patterns alongside performance variables to help discover true bottlenecks in daily execution.

The core philosophy of IRON is rooted in actionable feedback loops. The architecture allows you to quantify habits, measure execution friction, and analyze historical progress to make calculated adjustments over time.

### Key Features
*   **Dynamic Habit Engine:** Define habits with custom metrics (e.g., duration, difficulty, quantity) rather than binary checkmarks.
*   **Friction & Optimization Tracking:** Log qualitative and quantitative obstacles preventing consistent habit execution.
*   **Data Aggregation:** Generate comprehensive local summaries showing long-term consistency rates and optimization metrics.
*   **Persistent Storage:** Uses a structured layout to log data locally, ensuring full privacy and portability for your behavioral analytics.

### File Architecture & Component Breakdown
*   `project.py`: The core application script containing the primary control flow, the menu interface, and main functional logic.
*   `habits.py`: Manages the habit objects, custom metrics, and data validation rules for logging.
*   `storage.py`: Handles file input/output operations, reading from and writing user data securely to local files.
*   `analytics.py`: Processes historical log data to calculate performance optimizations, streaks, and trends.
*   `test_project.py`: A comprehensive suite of automated tests using `pytest` to verify key data-handling functions.

### Design Choices & Rationale
During development, a key decision was made to track "execution difficulty/friction" alongside the completion rate itself. Standard trackers fail when a user misses a habit, offering no context. By logging *why* or *how hard* a habit was to execute on a given day, IRON provides clear qualitative data that helps the user actively re-engineer their environment for better long-term optimization.

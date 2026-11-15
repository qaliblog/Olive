# Base-model failures

Model: LiquidAI/LFM2.5-350M on cuda:0. 46 held-out cases, 13% correct tool selection.

Every case below was scored from the model's raw generation; nothing was repaired by hand.

| case | suite | language | expected tool | parsed call |
| --- | --- | --- | --- | --- |
| olive.completion_verification.question_missing_file.en.0001 | baseline | en | list_directory | text only |
| olive.completion_verification.question_missing_file.en.0003 | baseline | en | search_code | run_shell |
| olive.dependency_installation.install_and_shell.en.0002 | tool_calling | en | run_shell | run_diagnostics |
| olive.dependency_installation.tailwind_landing.en.0007 | tool_calling | en | install_dependencies | text only |
| olive.error_recovery.missing_prop.fa.0036 | multilingual | fa | edit_file | unparseable |
| olive.file_creation.rn_edit_screen.en.0007 | coding | en | write_file | text only |
| olive.file_editing.coverage_edit_file.en.0002 | tool_calling | en | edit_file | text only |
| olive.file_editing.coverage_edit_file.en.0004 | tool_calling | en | edit_file | text only |
| olive.file_editing.coverage_edit_file.en.0006 | tool_calling | en | edit_file | text only |
| olive.file_editing.tailwind_hero.en.0019 | coding | en | write_file | text only |
| olive.file_reading.python_cli_range.en.0012 | tool_calling | en | read_file | text only |
| olive.file_reading.static_site_fa.fa.0034 | multilingual | fa | read_file | text only |
| olive.file_reading.static_site.en.0021 | tool_calling | en | read_file | text only |
| olive.file_reading.tailwind_landing.en.0015 | tool_calling | en | read_file | text only |
| olive.intent_understanding.python_cli.en.0022 | tool_calling | en | project_structure | inspect_diagnostics |
| olive.project_structure.static_site_fa.fa.0027 | multilingual | fa | project_structure | text only |
| olive.requirement_extraction.tailwind_landing.en.0052 | tool_calling | en | read_file | text only |
| olive.requirement_extraction.tailwind_landing.en.0054 | tool_calling | en | read_file | text only |
| olive.requirement_extraction.tailwind_landing.en.0056 | tool_calling | en | read_file | text only |
| olive.task_planning.capacitor_android.en.0019 | tool_calling | en | list_directory | text only |
| olive.task_planning.static_site_fa.fa.0053 | multilingual | fa | list_directory | text only |
| olive.file_editing.rn_add_note.en.0010 | baseline | en | write_file | text only |
| olive.file_editing.tailwind_pricing.en.0020 | baseline | en | write_file | text only |
| olive.code_generation.react_reports_page_fa.fa.0015 | baseline | fa | (text) | text only |
| olive.error_recovery.wrong_import_path.fa.0010 | baseline | fa | edit_file | unparseable |
| olive.dependency_installation.install_and_shell.en.0001 | baseline | en | install_dependencies | text only |
| olive.dependency_installation.install_and_shell.en.0003 | baseline | en | run_tests | run_diagnostics |
| olive.diagnostics.python_cli.en.0004 | baseline | en | inspect_diagnostics | text only |
| olive.file_editing.coverage_edit_file.en.0001 | baseline | en | edit_file | text only |
| olive.file_editing.coverage_edit_file.en.0003 | baseline | en | edit_file | text only |
| olive.file_editing.coverage_edit_file.en.0005 | baseline | en | edit_file | text only |
| olive.file_reading.python_cli.en.0011 | baseline | en | read_file | text only |
| olive.file_reading.static_site_range.en.0022 | baseline | en | read_file | text only |
| olive.file_reading.tailwind_landing_range.en.0016 | baseline | en | read_file | text only |
| olive.intent_understanding.python_cli.en.0021 | baseline | en | project_structure | text only |
| olive.intent_understanding.python_cli.en.0023 | baseline | en | project_structure | text only |
| olive.requirement_extraction.tailwind_landing.en.0051 | baseline | en | read_file | text only |
| olive.requirement_extraction.tailwind_landing.en.0053 | baseline | en | read_file | text only |
| olive.requirement_extraction.tailwind_landing.en.0055 | baseline | en | read_file | text only |
| olive.task_planning.capacitor_android.en.0018 | baseline | en | list_directory | text only |

Total failing cases: 40 of 46.

12 case entries repeat a record from another suite; the headline metrics count each record once.

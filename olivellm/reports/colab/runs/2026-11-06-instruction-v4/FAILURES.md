# Base-model failures

Model: LiquidAI/LFM2.5-350M on cuda:0. 71 cases, 15% correct tool selection.

Every case below was scored from the model's raw generation; nothing was repaired by hand.

| case | suite | language | expected tool | parsed call |
| --- | --- | --- | --- | --- |
| olive.dependency_installation.install_and_shell.en.0001 | tool_calling | en | install_dependencies | text only |
| olive.dependency_installation.install_and_shell.en.0003 | tool_calling | en | run_tests | inspect_diagnostics |
| olive.error_recovery.mixed_error_recovery.mixed.0011 | tool_calling | mixed | read_file | text only |
| olive.error_recovery.mixed_error_recovery.mixed.0013 | tool_calling | mixed | run_tests | text only |
| olive.file_creation.coverage_write_file.en.0006 | tool_calling | en | write_file | text only |
| olive.file_creation.coverage_write_file.en.0008 | tool_calling | en | write_file | text only |
| olive.file_creation.coverage_write_file.en.0010 | tool_calling | en | write_file | text only |
| olive.file_editing.css_logical_properties.en.0016 | tool_calling | en | write_file | text only |
| olive.file_editing.css_rtl_nav.en.0015 | tool_calling | en | write_file | text only |
| olive.file_editing.html_rtl_nav.en.0014 | tool_calling | en | write_file | text only |
| olive.file_reading.python_cli.en.0011 | tool_calling | en | read_file | text only |
| olive.intent_understanding.react_native.en.0015 | tool_calling | en | project_structure | text only |
| olive.intent_understanding.react_native.en.0017 | tool_calling | en | project_structure | text only |
| olive.project_structure.node_api.en.0001 | tool_calling | en | project_structure | text only |
| olive.requirement_extraction.react_dashboard.en.0021 | tool_calling | en | read_file | text only |
| olive.requirement_extraction.react_dashboard.en.0023 | tool_calling | en | read_file | text only |
| olive.requirement_extraction.react_dashboard.en.0025 | tool_calling | en | read_file | text only |
| olive.requirement_extraction.react_dashboard.en.0027 | tool_calling | en | read_file | text only |
| olive.task_planning.capacitor_android.en.0018 | tool_calling | en | list_directory | text only |
| olive.task_planning.capacitor_android.en.0020 | tool_calling | en | list_directory | text only |
| olive.file_creation.coverage_write_file.en.0006 | coding | en | write_file | text only |
| olive.file_creation.coverage_write_file.en.0007 | coding | en | write_file | text only |
| olive.file_creation.coverage_write_file.en.0008 | coding | en | write_file | text only |
| olive.file_creation.coverage_write_file.en.0009 | coding | en | write_file | text only |
| olive.file_creation.coverage_write_file.en.0010 | coding | en | write_file | text only |
| olive.file_creation.coverage_write_file.en.0011 | coding | en | write_file | text only |
| olive.file_editing.css_logical_properties.en.0016 | coding | en | write_file | text only |
| olive.file_editing.css_responsive_grid.en.0017 | coding | en | write_file | text only |
| olive.file_editing.css_rtl_nav.en.0015 | coding | en | write_file | text only |
| olive.file_editing.html_form_a11y.en.0018 | coding | en | write_file | text only |
| olive.file_editing.html_rtl_nav.en.0014 | coding | en | write_file | text only |
| olive.code_generation.python_json_flag_fa.fa.0017 | multilingual | fa | (text) | text only |
| olive.error_recovery.mixed_error_recovery_report.mixed.0014 | multilingual | mixed | (text) | text only |
| olive.error_recovery.mixed_error_recovery.mixed.0008 | multilingual | mixed | read_file | inspect_diagnostics |
| olive.error_recovery.mixed_error_recovery.mixed.0010 | multilingual | mixed | edit_file | text only |
| olive.error_recovery.mixed_error_recovery.mixed.0011 | multilingual | mixed | read_file | text only |
| olive.error_recovery.mixed_error_recovery.mixed.0012 | multilingual | mixed | edit_file | text only |
| olive.error_recovery.mixed_error_recovery.mixed.0013 | multilingual | mixed | run_tests | text only |
| olive.file_reading.react_native_fa.fa.0027 | multilingual | fa | read_file | text only |
| olive.project_structure.react_native_fa.fa.0020 | multilingual | fa | project_structure | text only |
| olive.task_planning.react_native_fa.fa.0044 | multilingual | fa | list_directory | text only |
| olive.code_generation.python_json_flag_fa.fa.0017 | baseline | fa | (text) | text only |
| olive.completion_verification.node_api.en.0001 | baseline | en | (text) | project_structure |
| olive.dependency_installation.install_and_shell_report.en.0004 | baseline | en | (text) | text only |
| olive.dependency_installation.install_and_shell.en.0002 | baseline | en | run_shell | text only |
| olive.error_recovery.mixed_error_recovery_report.mixed.0014 | baseline | mixed | (text) | text only |
| olive.error_recovery.mixed_error_recovery.mixed.0011 | baseline | mixed | read_file | text only |
| olive.error_recovery.mixed_error_recovery.mixed.0013 | baseline | mixed | run_tests | text only |
| olive.file_creation.coverage_write_file.en.0006 | baseline | en | write_file | text only |
| olive.file_creation.coverage_write_file.en.0008 | baseline | en | write_file | text only |
| olive.file_creation.coverage_write_file.en.0010 | baseline | en | write_file | text only |
| olive.file_editing.css_logical_properties.en.0016 | baseline | en | write_file | text only |
| olive.file_editing.css_rtl_nav.en.0015 | baseline | en | write_file | text only |
| olive.file_editing.html_rtl_nav.en.0014 | baseline | en | write_file | text only |
| olive.file_reading.python_cli.en.0011 | baseline | en | read_file | text only |
| olive.intent_understanding.react_native.en.0015 | baseline | en | project_structure | text only |
| olive.intent_understanding.react_native.en.0017 | baseline | en | project_structure | text only |
| olive.project_structure.node_api.en.0001 | baseline | en | project_structure | text only |
| olive.requirement_extraction.react_dashboard.en.0021 | baseline | en | read_file | text only |
| olive.requirement_extraction.react_dashboard.en.0023 | baseline | en | read_file | text only |
| olive.requirement_extraction.react_dashboard.en.0025 | baseline | en | read_file | text only |

Total failing cases: 61 of 71.

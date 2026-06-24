# Use UB_Date_ERP_Operation_log as the official operation log table

Status: accepted

The official operation log for the ERP is `UB_Date_ERP_Operation_log`. The earlier `Sys_OperationLogs` automatic audit table was test-era infrastructure and should not remain the source of truth for operation logs. The system will keep an automatic logging entrypoint where useful, but writes must target the legacy table shape so the new ERP matches the established old-system log semantics and display fields.

Consequences:

- Operation log pages read from `UB_Date_ERP_Operation_log`, not `Sys_OperationLogs`.
- New log writes use the legacy fields such as `act_name`, `act_info`, `uname`, `utruename`, `addtime`, `ip`, `code`, and `systemcode`.
- Existing test-era log text is not a business standard; module-specific log text can be rewritten later.
- Log write failures should be reported server-side but must not block the main business operation.

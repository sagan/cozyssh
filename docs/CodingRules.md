## Frontend

- Don't use `rem` (absolute size) unit in style / sx `fontSize`.
  since it doesn't work with CozySSH dynamic font sizing system. Use sx with MUI font size string instead:
  - `typography.h5.fontSize` : 24px / 1.5rem
  - `typography.h6.fontSize` : 20px / 1.25rem
  - `typography.body1.fontSize` : 16px / 1rem (default)
  - `typography.body2.fontSize` : 14px / 0.875rem
  - `typography.caption.fontSize` : 12px / 0.75rem

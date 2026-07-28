import React from 'react';
import { Icon } from '../core/Icon.jsx';

export function Field({ label, htmlFor, required = false, hint, error, badge, children, className = '' }) {
  return (
    <div className={`pl-field ${className}`.trim()}>
      {label ? (
        <label className="pl-field__label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="pl-field__req" aria-hidden="true">*</span> : null}
          {badge}
        </label>
      ) : null}
      {children}
      {error ? (
        <span className="pl-field__error"><Icon name="alert-circle" size={12} />{error}</span>
      ) : hint ? (
        <span className="pl-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

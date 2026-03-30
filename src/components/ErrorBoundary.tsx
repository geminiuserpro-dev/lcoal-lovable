import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import ErrorLayout from './ErrorLayout';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <ErrorLayout
          title="Something went wrong"
          description="An unexpected error occurred in the application."
          icon={<AlertTriangle size={32} />}
          showReload
          errorDetails={this.state.error?.message}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

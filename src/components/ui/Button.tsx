import { ButtonHTMLAttributes, forwardRef } from "react";
import { Loader2 } from "lucide-react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline";
  size?: "sm" | "md" | "lg" | "icon";
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "primary", size = "md", isLoading, children, disabled, ...props }, ref) => {
    const baseStyles = "inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";
    
    const variants = {
      primary: "bg-emerald-600 hover:bg-emerald-500 text-white border border-transparent",
      secondary: "bg-zinc-800 hover:bg-zinc-700 text-white border border-transparent",
      danger: "bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-transparent",
      ghost: "bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-white border border-transparent",
      outline: "bg-transparent border border-zinc-700 hover:border-zinc-600 text-white",
    };

    const sizes = {
      sm: "px-3 py-1.5 text-sm rounded-lg gap-1.5",
      md: "px-4 py-2 text-base rounded-xl gap-2",
      lg: "px-6 py-3 text-lg rounded-xl gap-2",
      icon: "p-2 rounded-xl",
    };

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

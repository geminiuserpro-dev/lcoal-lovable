import React from "react";
import ErrorLayout from "@/components/ErrorLayout";
import { ServerCrash } from "lucide-react";

const InternalError = () => {
  return (
    <ErrorLayout
      code="500"
      title="Internal Server Error"
      description="Something went wrong on our end. We're working on fixing it."
      icon={<ServerCrash size={32} />}
      showReload
    />
  );
};

export default InternalError;

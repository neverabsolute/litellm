-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_DailyIPActivity" (
    "date" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "api_key" TEXT NOT NULL DEFAULT '',
    "successful_requests" BIGINT NOT NULL DEFAULT 0,
    "failed_requests" BIGINT NOT NULL DEFAULT 0,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "total_tokens" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_DailyIPActivity_pkey" PRIMARY KEY ("date","ip_address","api_key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_DailyDeniedRequests" (
    "date" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "api_key" TEXT NOT NULL DEFAULT '',
    "denied_requests" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_DailyDeniedRequests_pkey" PRIMARY KEY ("date","ip_address","route","status_code","reason","api_key")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyIPActivity_date_idx" ON "LiteLLM_DailyIPActivity"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyIPActivity_ip_address_date_idx" ON "LiteLLM_DailyIPActivity"("ip_address", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyDeniedRequests_date_idx" ON "LiteLLM_DailyDeniedRequests"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyDeniedRequests_ip_address_date_idx" ON "LiteLLM_DailyDeniedRequests"("ip_address", "date");

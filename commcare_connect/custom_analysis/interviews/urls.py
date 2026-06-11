from django.urls import path

from . import views

app_name = "interviews"

urlpatterns = [
    path("", views.InterviewsDashboardView.as_view(), name="dashboard"),
    path("api/metrics/", views.InterviewsMetricsView.as_view(), name="api_metrics"),
    path("api/bots/", views.InterviewsBotsView.as_view(), name="api_bots"),
    path("api/cohort-metrics/", views.InterviewsCohortMetricsView.as_view(), name="api_cohort_metrics"),
    path("api/sync/trigger/", views.InterviewsSyncTriggerView.as_view(), name="api_sync_trigger"),
    path("api/sync/status/", views.InterviewsSyncStatusView.as_view(), name="api_sync_status"),
    path("api/answers.xlsx", views.InterviewsAnswersXlsxView.as_view(), name="api_answers_xlsx"),
    path("api/cohort-metrics.xlsx", views.InterviewsCohortXlsxView.as_view(), name="api_cohort_xlsx"),
    path("api/per-session.xlsx", views.InterviewsPerSessionXlsxView.as_view(), name="api_per_session_xlsx"),
]

"""
Postgres cache models for Connect Interviews Step 1 output.

Mirrors Neal's R script `answers.csv` schema (one row per FLW × question) plus
session-level processing status for incremental updates.

Both models use `app_label = "labs"` so they live under the existing labs app's
migrations — no need to register `interviews` as a separate Django app.

Forward-compatibility fields (pipeline_version, experiment_id, questions_version,
computed_fields) are baked in so future Steps 2-6 (LLM scoring, typologies,
findings, exports) plug in without requiring schema migrations on every change.
"""

from django.db import models


class InterviewAnswer(models.Model):
    """
    One row per (session_id, qid, pipeline_version) — the Step 1 output substrate.

    Mirrors Neal's R `answers.csv` columns. All future metrics (median message
    length, per-question completion, typology classification, etc.) are
    computed by aggregating over this table.
    """

    # Session identity
    session_id = models.CharField(max_length=64, db_index=True)
    participant_id = models.CharField(max_length=255, db_index=True, blank=True)

    # Question identity
    qid = models.CharField(max_length=32, db_index=True, help_text="e.g. 'A.1', 'A.5b'")
    parent_qid = models.CharField(max_length=32, db_index=True, help_text="e.g. 'A.1', 'A.5'")
    question_text = models.TextField(blank=True)
    topic = models.CharField(max_length=128, blank=True)

    # Answer content
    answer_text = models.TextField(blank=True, null=True)
    asked = models.BooleanField(default=True, help_text="Was this question offered in the session?")
    completed = models.BooleanField(default=False, help_text="Did the FLW give a substantive answer?")

    # Answer stats
    num_turns = models.IntegerField(null=True, blank=True)
    word_count = models.IntegerField(default=0)
    time_to_answer_seconds = models.FloatField(null=True, blank=True)

    # Provenance
    extraction_method = models.CharField(
        max_length=32,
        help_text="'word_overlap' for single-part, 'llm' for multi-part",
    )

    # Cohort linkage (Connect opportunity this session belongs to)
    opportunity_id = models.IntegerField(null=True, blank=True, db_index=True)
    cohort_name = models.CharField(max_length=255, blank=True, db_index=True)

    # Forward-compat: pipeline / source versioning
    pipeline_version = models.CharField(
        max_length=32,
        default="1.0",
        db_index=True,
        help_text="Bump when prompts/algorithm change to keep historical results",
    )
    experiment_id = models.CharField(
        max_length=64,
        blank=True,
        db_index=True,
        help_text="OCS bot UUID — supports multi-bot in future",
    )
    questions_version = models.CharField(
        max_length=32,
        blank=True,
        help_text="Identifier for the questions file used (e.g. 'round3_expanded')",
    )

    # Forward-compat: schemaless field for Steps 2-6 to populate
    # (ai_generated_flag, quality_score, typology_id, etc.) without migrations
    computed_fields = models.JSONField(
        default=dict,
        blank=True,
        help_text="Step 2-6 derived fields (scoring, typologies, etc.)",
    )

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "labs"
        db_table = "interviews_answer"
        unique_together = [("session_id", "qid", "pipeline_version")]
        indexes = [
            models.Index(fields=["opportunity_id", "completed"]),
            models.Index(fields=["cohort_name", "completed"]),
            models.Index(fields=["participant_id", "completed"]),
            models.Index(fields=["experiment_id", "pipeline_version"]),
        ]


class InterviewSessionStatus(models.Model):
    """
    Tracks which OCS sessions have been processed by Step 1.

    Used to skip already-processed sessions on incremental runs and to surface
    failures to the dashboard.
    """

    STATUS_PROCESSED = "processed"
    STATUS_FAILED = "failed"
    STATUS_SKIPPED = "skipped"
    STATUS_CHOICES = [
        (STATUS_PROCESSED, "Processed"),
        (STATUS_FAILED, "Failed"),
        (STATUS_SKIPPED, "Skipped (no questions matched)"),
    ]

    session_id = models.CharField(max_length=64, primary_key=True)
    participant_id = models.CharField(max_length=255, blank=True, db_index=True)
    opportunity_id = models.IntegerField(null=True, blank=True, db_index=True)
    experiment_id = models.CharField(
        max_length=64,
        blank=True,
        db_index=True,
        help_text="OCS bot UUID this session belongs to",
    )

    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PROCESSED)
    error_message = models.TextField(blank=True)

    # Forward-compat: pipeline versioning
    pipeline_version = models.CharField(max_length=32, default="1.0", db_index=True)

    # Stats from processing
    total_messages = models.IntegerField(default=0)
    answer_rows_created = models.IntegerField(default=0)
    llm_calls_made = models.IntegerField(default=0)
    total_input_tokens = models.IntegerField(default=0)
    total_output_tokens = models.IntegerField(default=0)

    # Timestamps
    session_created_at = models.DateTimeField(null=True, blank=True, help_text="From OCS session.created_at")
    processed_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "labs"
        db_table = "interviews_session_status"
        indexes = [
            models.Index(fields=["experiment_id", "session_created_at"]),
        ]

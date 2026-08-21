from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


OUTPUT = Path(__file__).resolve().parents[1] / "output" / "pdf" / "fake-biocbot-feedback.pdf"


def build_pdf() -> Path:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    body = ParagraphStyle(
        "FeedbackBody",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10.5,
        leading=15,
        textColor=HexColor("#27364A"),
        spaceAfter=8,
    )
    section = ParagraphStyle(
        "FeedbackSection",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        textColor=HexColor("#174A7E"),
        spaceBefore=8,
        spaceAfter=5,
    )
    small = ParagraphStyle(
        "FeedbackSmall",
        parent=body,
        fontSize=8.5,
        leading=11,
        textColor=HexColor("#5E6C7B"),
    )

    document = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=LETTER,
        rightMargin=0.7 * inch,
        leftMargin=0.7 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        title="Fake BiocBot Assignment Feedback",
        author="BiocBot local integration test",
    )

    header = Table(
        [[
            Paragraph("<b>BiocBot written feedback</b>", ParagraphStyle(
                "HeaderTitle", parent=body, fontSize=17, leading=20, textColor=HexColor("#FFFFFF")
            )),
            Paragraph("LOCAL TEST", ParagraphStyle(
                "HeaderBadge", parent=small, fontName="Helvetica-Bold", fontSize=9,
                alignment=2, textColor=HexColor("#D9ECFF")
            )),
        ]],
        colWidths=[5.7 * inch, 1.0 * inch],
    )
    header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor("#123B63")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 16),
        ("RIGHTPADDING", (-1, 0), (-1, 0), 16),
        ("TOPPADDING", (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
    ]))

    summary = Table([
        [Paragraph("<b>Assignment</b><br/>BiocBot Feedback PDF Test", body),
         Paragraph("<b>Submission attempt</b><br/>1", body),
         Paragraph("<b>Overall</b><br/>Strong draft", body)],
    ], colWidths=[3.2 * inch, 1.65 * inch, 1.85 * inch])
    summary.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor("#EEF5FB")),
        ("BOX", (0, 0), (-1, -1), 0.75, HexColor("#B8CEE2")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, HexColor("#CADAE8")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))

    story = [
        header,
        Spacer(1, 0.22 * inch),
        summary,
        Spacer(1, 0.18 * inch),
        Paragraph("What worked well", section),
        Paragraph(
            "Your explanation connects enzyme structure to catalytic function clearly. The progression "
            "from substrate binding to transition-state stabilization is easy to follow, and the example "
            "supports the central claim.",
            body,
        ),
        Paragraph("Suggestions for revision", section),
        Paragraph(
            "Clarify how the proposed mutation changes the active-site microenvironment. Add one sentence "
            "distinguishing an effect on binding affinity from an effect on catalytic turnover, and support "
            "that distinction with the relevant kinetic parameter.",
            body,
        ),
        Paragraph("Recommended next step", section),
        Paragraph(
            "Revise the final paragraph to compare the expected change in K<sub>m</sub> with the expected "
            "change in k<sub>cat</sub>. Then check that the conclusion answers the original question directly.",
            body,
        ),
        Spacer(1, 0.24 * inch),
        Table([[Paragraph(
            "This is generated sample content for the local Canvas integration test. It is not real student feedback.",
            small,
        )]], colWidths=[6.7 * inch], style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), HexColor("#FFF6E8")),
            ("BOX", (0, 0), (-1, -1), 0.75, HexColor("#E6C68A")),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ])),
    ]
    document.build(story)
    return OUTPUT


if __name__ == "__main__":
    print(build_pdf())

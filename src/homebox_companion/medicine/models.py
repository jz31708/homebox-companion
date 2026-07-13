from datetime import datetime

from pydantic import BaseModel, Field


class MedicineReference(BaseModel):
    cip13: str
    cip7: str | None = None
    cis: str
    name: str
    pharmaceutical_form: str | None = None
    presentation: str | None = None
    active_substances: list[str] = Field(default_factory=list)
    authorization_holder: str | None = None
    official_page_url: str
    notice_url: str
    rcp_url: str | None = None
    source_updated_at: str | None = None
    source_name: str = "Base de Données Publique des Médicaments"


class NoticeSection(BaseModel):
    heading: str
    paragraphs: list[str] = Field(default_factory=list)


class NoticeDocument(BaseModel):
    cis: str
    source_url: str
    retrieved_at: datetime
    title: str
    sections: list[NoticeSection] = Field(default_factory=list)
    source_updated_at: str | None = None
    sha256: str | None = None

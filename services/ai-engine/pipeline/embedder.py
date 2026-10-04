import logging
from typing import List, Union
import numpy as np
from sentence_transformers import SentenceTransformer
from config import settings

logger = logging.getLogger(__name__)

class SentenceEmbedder:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(SentenceEmbedder, cls).__new__(cls)
            cls._instance._model = None
        return cls._instance

    def load_model(self):
        if self._model is None:
            logger.info("Loading Sentence Transformer model: %s", settings.EMBEDDING_MODEL_NAME)
            self._model = SentenceTransformer(settings.EMBEDDING_MODEL_NAME)
            logger.info("Sentence Transformer loaded successfully (Embedding Dimension: %d)", settings.EMBEDDING_DIMENSION)

    def encode(self, texts: Union[str, List[str]], normalize: bool = True) -> np.ndarray:
        """
        Generates dense vector embeddings.
        If normalize=True, vectors are L2-normalized so that inner product equals cosine similarity.
        """
        if self._model is None:
            self.load_model()
        
        is_single = isinstance(texts, str)
        input_texts = [texts] if is_single else texts
        
        embeddings = self._model.encode(
            input_texts,
            convert_to_numpy=True,
            show_progress_bar=False,
            normalize_embeddings=normalize
        )
        
        embeddings = embeddings.astype(np.float32)
        return embeddings[0] if is_single else embeddings

embedder = SentenceEmbedder()

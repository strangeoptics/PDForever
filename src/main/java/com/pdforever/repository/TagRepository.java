package com.pdforever.repository;

import com.pdforever.domain.Tag;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface TagRepository extends JpaRepository<Tag, Long> {

    Optional<Tag> findByNameIgnoreCase(String name);

    List<Tag> findAllByOrderByNameAsc();

    @Modifying
    @Query(value = "DELETE FROM document_tags WHERE tag_id = :tagId", nativeQuery = true)
    void deleteDocumentTagAssociations(@Param("tagId") Long tagId);
}


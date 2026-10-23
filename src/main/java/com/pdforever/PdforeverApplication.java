package com.pdforever;

import com.pdforever.config.LibraryProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

@SpringBootApplication
@EnableConfigurationProperties(LibraryProperties.class)
@EnableScheduling
public class PdforeverApplication {

    public static void main(String[] args) throws IOException {
        Files.createDirectories(Path.of("./data"));
        Files.createDirectories(Path.of("./storage"));
        SpringApplication.run(PdforeverApplication.class, args);
    }
}


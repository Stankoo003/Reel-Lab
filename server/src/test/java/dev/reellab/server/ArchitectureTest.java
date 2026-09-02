package dev.reellab.server;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.library.Architectures;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Makes "layer boundaries are real" a build failure rather than a review comment.
 */
class ArchitectureTest {

    private static JavaClasses classes;

    @BeforeAll
    static void importClasses() {
        classes = new ClassFileImporter()
                .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages("dev.reellab.server");
    }

    @Test
    void controllersNeverTouchRepositories() {
        noClasses().that().resideInAPackage("..web..")
                .should().dependOnClassesThat().resideInAPackage("..persistence.repository..")
                .because("controllers must go through the service layer")
                .check(classes);
    }

    @Test
    void persistenceNeverDependsOnWebOrService() {
        noClasses().that().resideInAPackage("..persistence..")
                .should().dependOnClassesThat().resideInAnyPackage("..web..", "..service..")
                .because("dependencies point one way: web -> service -> persistence")
                .check(classes);
    }

    @Test
    void serviceNeverDependsOnWeb() {
        noClasses().that().resideInAPackage("..service..")
                .should().dependOnClassesThat().resideInAPackage("..web..")
                .because("business rules must not know about HTTP or DTOs")
                .check(classes);
    }

    @Test
    void layersAreRespected() {
        Architectures.layeredArchitecture().consideringOnlyDependenciesInLayers()
                .layer("Web").definedBy("..web..")
                .layer("Service").definedBy("..service..")
                .layer("Persistence").definedBy("..persistence..")
                .whereLayer("Web").mayNotBeAccessedByAnyLayer()
                .whereLayer("Service").mayOnlyBeAccessedByLayers("Web")
                .whereLayer("Persistence").mayOnlyBeAccessedByLayers("Service", "Web")
                .check(classes);
    }
}
